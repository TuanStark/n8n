#!/usr/bin/env python3
"""
AGY Bridge Daemon
Lightweight HTTP Service exposing Google Antigravity CLI (agy) on host
to internal Docker containers and local workers.
"""

import json
import logging
import os
import re
import subprocess
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler

PORT = int(os.environ.get("AGY_BRIDGE_PORT", "4150"))
HOST = os.environ.get("AGY_BRIDGE_HOST", "0.0.0.0")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [AgyBridge] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger("AgyBridge")

# Semaphore to serialize or limit simultaneous agy calls
call_lock = threading.Semaphore(2)

def clean_json_text(raw_text: str) -> str:
    cleaned = raw_text.strip()
    match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", cleaned)
    if match:
        cleaned = match.group(1).strip()
    return cleaned

def invoke_agy(prompt: str, system_instruction: str = "", json_mode: bool = True, timeout_sec: int = 120) -> dict:
    parts = []
    if system_instruction:
        parts.append(f"[System Instruction]\n{system_instruction.strip()}\n")
    if json_mode:
        parts.append("[Format Requirement]\nOutput MUST be valid JSON only. Do not wrap in markdown or commentary.\n")
    parts.append(f"[Prompt]\n{prompt.strip()}")

    full_prompt = "\n".join(parts)

    cmd = ["/usr/local/bin/agy", "-p", full_prompt]

    logger.info("Executing agy prompt (%d chars)...", len(full_prompt))
    
    with call_lock:
        try:
            res = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=timeout_sec,
                env=dict(os.environ, HOME="/root")
            )
        except subprocess.TimeoutExpired:
            logger.error("agy call timed out after %ds", timeout_sec)
            return {"success": False, "error": f"agy call timed out after {timeout_sec}s"}
        except Exception as e:
            logger.error("Failed to execute agy: %s", str(e))
            return {"success": False, "error": str(e)}

    if res.returncode != 0:
        logger.error("agy exited with code %d. Stderr: %s", res.returncode, res.stderr.strip())
        return {
            "success": False,
            "error": f"agy error (code {res.returncode}): {res.stderr.strip() or res.stdout.strip()}"
        }

    raw_output = res.stdout.strip()
    cleaned = clean_json_text(raw_output)

    parsed_data = None
    if json_mode:
        try:
            parsed_data = json.loads(cleaned)
        except Exception:
            # Fallback regex search for outer JSON object or array
            first_brace = cleaned.find("{")
            first_bracket = cleaned.find("[")
            start = -1
            if first_brace != -1 and first_bracket != -1:
                start = min(first_brace, first_bracket)
            else:
                start = max(first_brace, first_bracket)

            last_brace = cleaned.rfind("}")
            last_bracket = cleaned.rfind("]")
            end = max(last_brace, last_bracket)

            if start != -1 and end != -1 and end > start:
                try:
                    parsed_data = json.loads(cleaned[start:end+1])
                except Exception as parse_err:
                    logger.warning("Could not parse output as JSON: %s", parse_err)

    return {
        "success": True,
        "text": raw_output,
        "cleaned": cleaned,
        "data": parsed_data
    }


class AgyRequestHandler(BaseHTTPRequestHandler):
    def _send_response(self, status_code: int, data: dict):
        response_bytes = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(response_bytes)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(response_bytes)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        if self.path == "/health" or self.path == "/":
            self._send_response(200, {
                "status": "ok",
                "service": "agy-bridge",
                "binary": "/usr/local/bin/agy"
            })
        else:
            self._send_response(404, {"error": "Not Found"})

    def do_POST(self):
        if self.path == "/api/generate" or self.path == "/v1/chat":
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length).decode("utf-8")

            try:
                payload = json.loads(body) if body else {}
            except Exception as e:
                self._send_response(400, {"error": f"Invalid JSON payload: {e}"})
                return

            prompt = payload.get("prompt", "")
            if not prompt:
                self._send_response(400, {"error": "Missing 'prompt' field in request body"})
                return

            system_instruction = payload.get("systemInstruction", "")
            json_mode = payload.get("jsonMode", True)
            timeout_sec = payload.get("timeoutSec", 120)

            result = invoke_agy(
                prompt=prompt,
                system_instruction=system_instruction,
                json_mode=json_mode,
                timeout_sec=timeout_sec
            )

            status = 200 if result.get("success") else 500
            self._send_response(status, result)
        else:
            self._send_response(404, {"error": "Not Found"})

    def log_message(self, format, *args):
        # Format custom log message
        logger.info("%s - - [%s] %s", self.client_address[0], self.log_date_time_string(), format % args)


def run_server():
    server_address = (HOST, PORT)
    httpd = HTTPServer(server_address, AgyRequestHandler)
    logger.info("Starting AGY Bridge server on http://%s:%d", HOST, PORT)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
        logger.info("Server stopped.")


if __name__ == "__main__":
    run_server()
