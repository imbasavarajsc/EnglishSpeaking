import time

import httpx

for i in range(5):
    t0 = time.time()
    r = httpx.get("https://generativelanguage.googleapis.com/", timeout=10)
    print(f"{time.time() - t0:.2f}s  (status {r.status_code})")
    time.sleep(0.5)