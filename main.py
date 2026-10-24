import os
import random
import time
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
from datetime import datetime
from zoneinfo import ZoneInfo

from dotenv import load_dotenv
from fastapi import FastAPI, Request, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from google import genai
from google.genai import types

load_dotenv()
client = genai.Client(
    api_key=os.getenv("GEMINI_API_KEY"),
    http_options=types.HttpOptions(timeout=10000),  # one call is abandoned after 10 seconds
)

# The server keeps track of which of these is answering fastest and tries that one first
MODELS = [
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-flash-lite-latest",
    "gemini-3.5-flash",
]
HEDGE_MIN = 3.5       # never send a backup request sooner than this many seconds
HEDGE_MAX = 6.0       # ...and never wait longer than this before sending one
HEDGE_FACTOR = 1.6    # backup after 1.6x the fastest model's recent average time
TIME_BUDGET = 12      # stop waiting after this many seconds in total
MAX_LAUNCHES = 3      # most requests we will send for one learner turn
ALPHA = 0.4           # how quickly the speed ranking reacts to new results
FAIL_PENALTY = 12.0   # a failed call counts as this many seconds

TUTOR_NAME = "Captain Hamsa"  # change this when you choose the final name
MAX_MESSAGES = 20     # only the most recent messages are sent, to keep replies fast

DAILY_TURN_LIMIT = 120   # per visitor per day, about 1 hour of conversation
DAILY_IP_LIMIT = 100000    # backup cap against bots; many students can share one IP

SYSTEM_PROMPT = """You are {name}, a friendly English speaking partner for a learner in India.
The learner's words come from speech-to-text, so IGNORE punctuation, capital letters
and spelling. Only look at grammar, word choice, and how natural the sentence sounds.

Look ONLY at the learner's LAST message and fill these fields:
- reply: your name is {name}. First answer anything the learner asked you, directly
  and briefly (your name, your opinion, simple facts). Then, only if it fits
  naturally, add one easy follow-up question. Total 1 to 3 short, simple sentences.
  Never repeat the same question twice. No emojis or symbols, because it is read aloud.
- has_mistake: true only if the last message has a real grammar or wording mistake.
  Be kind: if the meaning is clear and the sentence is acceptable, set false.
- corrected: the corrected, natural version of the learner's sentence, written with normal
  capital letters and punctuation. Empty if no mistake.
- tip: one very short, simple explanation of the mistake (max 15 words). Empty if no mistake.""".replace("{name}", TUTOR_NAME)

LEVELS = {
    "beginner": (
        "LEVEL: The learner is a BEGINNER. Use very simple, common words and short "
        "sentences (under 10 words each). Talk about everyday topics like family, food, "
        "and daily routine. Be extra encouraging. Only correct the most important mistake."
    ),
    "intermediate": (
        "LEVEL: The learner is INTERMEDIATE. Use clear everyday English and natural "
        "sentences. Correct clear grammar and word-choice mistakes."
    ),
    "advanced": (
        "LEVEL: The learner is ADVANCED. Use natural, richer vocabulary and common "
        "idioms, and ask deeper questions that need longer answers. Also correct "
        "unnatural phrasing and suggest better word choices."
    ),
}

# Only these topic keys are accepted from the browser
TOPICS = {
    "routine": "the learner's daily routine",
    "food": "food and cooking",
    "college": "college life and studies",
    "hobbies": "hobbies and free time",
    "travel": "travel and places",
    "movies": "movies, series and music",
    "future": "future plans, goals and dream jobs",
    "family": "family and friends",
}

app = FastAPI()
executor = ThreadPoolExecutor(max_workers=12)


class Message(BaseModel):
    role: str  # "user" or "ai"
    text: str


class ChatRequest(BaseModel):
    history: list[Message]
    level: str = "intermediate"
    topic: str = ""


class AIReply(BaseModel):
    reply: str
    has_mistake: bool
    corrected: str
    tip: str


usage = {}  # key -> (day, count). Resets when the server restarts; fine for now.

# Recent average response time (seconds) of each model. Starts equal, then adapts.
latency = {m: 3.0 for m in MODELS}


def record(model, seconds):
    latency[model] = (1 - ALPHA) * latency[model] + ALPHA * seconds


def model_order():
    order = sorted(MODELS, key=lambda m: latency[m])
    # Now and then try the second-best first, so a model that was slow once can earn its place back
    if random.random() < 0.1:
        order[0], order[1] = order[1], order[0]
    return order


def today_ist():
    # The day always changes at 12:00 AM Indian time, wherever the server runs
    return datetime.now(ZoneInfo("Asia/Kolkata")).date().isoformat()


def used_today(key):
    today = today_ist()
    day, count = usage.get(key, (today, 0))
    return count if day == today else 0


def add_use(key):
    usage[key] = (today_ist(), used_today(key) + 1)


def call_gemini(model, contents, system):
    t0 = time.time()
    try:
        response = client.models.generate_content(
            model=model,
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=system,
                response_mime_type="application/json",
                response_schema=AIReply,
            ),
        )
    except Exception as e:
        record(model, FAIL_PENALTY)
        print(f"CHAT ERROR ({model}, after {time.time() - t0:.1f}s):", repr(e))
        raise
    took = time.time() - t0
    record(model, took)
    print(f"Gemini {model} took {took:.1f}s")
    return response


def generate_with_backup(contents, system):
    """Send a request to the currently fastest model; if it is slow, send a backup to
    the next one and use whichever answers first. Returns None if nothing worked in time."""
    order = model_order()
    hedge_delay = min(HEDGE_MAX, max(HEDGE_MIN, HEDGE_FACTOR * latency[order[0]]))
    print(
        "Model order:",
        ", ".join(f"{m} ({latency[m]:.1f}s)" for m in order),
        f"| backup after {hedge_delay:.1f}s",
    )

    started = time.time()
    pending = set()
    launched = 0

    def launch():
        nonlocal launched
        model = order[launched % len(order)]
        launched += 1
        pending.add(executor.submit(call_gemini, model, contents, system))

    launch()
    while True:
        remaining = TIME_BUDGET - (time.time() - started)
        if remaining <= 0:
            return None

        can_launch_more = launched < MAX_LAUNCHES
        wait_time = min(remaining, hedge_delay) if can_launch_more else remaining
        done, _ = wait(pending, timeout=wait_time, return_when=FIRST_COMPLETED)

        if not done:
            # Nothing answered yet: send a backup request and keep waiting
            if can_launch_more:
                launch()
            continue

        for future in done:
            pending.discard(future)
            try:
                return future.result()
            except Exception:
                pass  # already printed in call_gemini

        # A request failed. If nothing else is running, try again (after a short pause)
        if not pending:
            if launched >= MAX_LAUNCHES:
                return None
            time.sleep(0.5)
            launch()


@app.post("/chat")
def chat(req: ChatRequest, request: Request):
    visitor = request.headers.get("x-visitor-id", "")[:64] or "unknown"
    ip = request.client.host if request.client else "unknown"
    vkey, ikey = f"v:{visitor}", f"ip:{ip}"

    if used_today(vkey) >= DAILY_TURN_LIMIT or used_today(ikey) >= DAILY_IP_LIMIT:
        raise HTTPException(status_code=429, detail="daily_limit")

    messages = req.history[-MAX_MESSAGES:]
    contents = []
    # Gemini wants the conversation to start with the learner
    if messages and messages[0].role == "ai":
        contents.append(types.Content(role="user", parts=[types.Part(text="Hello")]))
    for m in messages:
        contents.append(
            types.Content(
                role="user" if m.role == "user" else "model",
                parts=[types.Part(text=m.text)],
            )
        )

    system = SYSTEM_PROMPT + "\n\n" + LEVELS.get(req.level, LEVELS["intermediate"])

    topic_text = TOPICS.get(req.topic)
    if topic_text:
        system += (
            "\n\nTOPIC: The learner chose to talk about " + topic_text + ". "
            "Keep the conversation on this topic. After answering what they said, "
            "bring them back to it with a related question, unless they clearly ask "
            "to change the subject."
        )

    response = generate_with_backup(contents, system)
    if response is None:
        raise HTTPException(status_code=503, detail="busy")

    add_use(vkey)  # only count turns that actually worked
    add_use(ikey)
    return response.parsed


# This must stay LAST, after all routes
app.mount("/", StaticFiles(directory="static", html=True), name="static")