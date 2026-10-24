import os
import sys
import time
from dotenv import load_dotenv
from google import genai

load_dotenv()
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

if len(sys.argv) < 2:
    print("Models with 'flash' in the name:")
    for m in client.models.list():
        if "flash" in m.name.lower():
            print(" ", m.name)
else:
    model = sys.argv[1]
    t0 = time.time()
    r = client.models.generate_content(
        model=model, contents="Say hello in one short sentence."
    )
    print(r.text)
    print(f"Took {time.time() - t0:.1f}s")