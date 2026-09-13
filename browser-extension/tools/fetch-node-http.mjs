import http from "node:http";
import https from "node:https";

function requestText(input, options = {}, redirects = 0) {
  if (redirects > 6) return Promise.reject(new Error("Too many redirects"));
  const url = input instanceof URL ? input : new URL(String(input));
  const transport = url.protocol === "http:" ? http : https;

  return new Promise((resolve, reject) => {
    const headers = { ...(options.headers || {}), "accept-encoding": "identity" };
    const req = transport.request(url, {
      method: "GET",
      headers,
      timeout: 25000
    }, (res) => {
      const status = Number(res.statusCode || 0);
      const location = res.headers.location;
      if (status >= 300 && status < 400 && location) {
        res.resume();
        const next = new URL(location, url);
        requestText(next, options, redirects + 1).then(resolve, reject);
        return;
      }

      const chunks = [];
      let total = 0;
      const MAX_BYTES = 32 * 1024 * 1024;
      res.on("data", (chunk) => {
        total += chunk.length;
        if (total > MAX_BYTES) {
          req.destroy(new Error(`Response too large: ${url}`));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        resolve({
          ok: status >= 200 && status < 300,
          status,
          text: async () => body
        });
      });
      res.on("error", reject);
    });

    req.on("timeout", () => req.destroy(new Error(`HTTP timeout: ${url}`)));
    req.on("error", reject);

    const signal = options.signal;
    if (signal) {
      if (signal.aborted) {
        req.destroy(new Error(`Aborted: ${url}`));
      } else {
        signal.addEventListener("abort", () => req.destroy(new Error(`Aborted: ${url}`)), { once: true });
      }
    }
    req.end();
  });
}

globalThis.fetch = requestText;
