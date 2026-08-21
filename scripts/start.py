#!/usr/bin/env python3
"""
Quick-start script — sets up venv, installs deps, and starts both servers.
Run from the samjhauta/ root directory.

Usage: python scripts/start.py
"""
import subprocess, sys, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND = os.path.join(ROOT, "backend")
FRONTEND = os.path.join(ROOT, "frontend")

VENV = os.path.join(BACKEND, ".venv")
PY = os.path.join(VENV, "Scripts", "python.exe") if sys.platform == "win32" else os.path.join(VENV, "bin", "python")
PIP = os.path.join(VENV, "Scripts", "pip.exe") if sys.platform == "win32" else os.path.join(VENV, "bin", "pip")

def run(cmd, cwd=None, **kwargs):
    print(f"\n$ {' '.join(cmd)}")
    return subprocess.run(cmd, cwd=cwd, check=True, **kwargs)

print("=" * 60)
print("  SAMJHAUTA — Quick Start")
print("=" * 60)

# Check .env
env_path = os.path.join(ROOT, ".env")
if not os.path.exists(env_path):
    example = os.path.join(ROOT, ".env.example")
    import shutil
    shutil.copy(example, env_path)
    print(f"\n⚠️  Created .env from .env.example. Please add your API keys to: {env_path}\n")

# Backend venv
if not os.path.exists(VENV):
    run([sys.executable, "-m", "venv", ".venv"], cwd=BACKEND)

run([PIP, "install", "-r", "requirements.txt", "-q"], cwd=BACKEND)
print("\n✅ Backend dependencies installed.")

# Start backend
print("\n🚀 Starting backend on http://localhost:8000 ...")
backend_proc = subprocess.Popen(
    [PY, "-m", "uvicorn", "app.main:app", "--reload", "--port", "8000"],
    cwd=BACKEND,
    env={**os.environ, "PYTHONPATH": BACKEND},
)

# Start frontend
print("🚀 Starting frontend on http://localhost:3000 ...")
frontend_proc = subprocess.Popen(
    ["npm", "run", "dev"],
    cwd=FRONTEND,
    shell=True,
)

print("\n" + "=" * 60)
print("  ✅ Both servers running!")
print("  Frontend: http://localhost:3000")
print("  Backend:  http://localhost:8000")
print("  API docs: http://localhost:8000/docs")
print("  Press Ctrl+C to stop.")
print("=" * 60 + "\n")

try:
    backend_proc.wait()
except KeyboardInterrupt:
    backend_proc.terminate()
    frontend_proc.terminate()
    print("\nShutting down…")
