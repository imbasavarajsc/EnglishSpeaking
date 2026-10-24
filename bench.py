import os
import sys
import time

from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()
client = genai.Client(
    api_key=os.getenv("GEMINI_API_KEY"),
    http_options=types.HttpOptions(timeout=20000),
)

MODELS = sys.argv[1:] or [
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-flash-lite-latest",
    "gemini-3.5-flash",
]
PROMPT = "Reply in one short sentence: what is a good way to practise English every day?"
RUNS = 5

for model in MODELS:
    times = []
    errors = 0
    for i in range(RUNS):
        t0 = time.time()
        try:
            client.models.generate_content(model=model, contents=PROMPT)
            times.append(time.time() - t0)
        except Exception as e:
            errors += 1
            print(f"  {model} error after {time.time() - t0:.1f}s: {str(e)[:90]}")
        time.sleep(0.5)
    if times:
        print(
            f"{model}: average {sum(times) / len(times):.1f}s, "
            f"slowest {max(times):.1f}s, errors {errors}/{RUNS}"
        )
    else:
        print(f"{model}: all {RUNS} calls failed")