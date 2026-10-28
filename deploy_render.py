#!/usr/bin/env python3
"""把 nba-site 发布到 Render。

两种用法：
  A) 只给 Render API Key + 一个已存在的公开 Git 仓库：
       set RENDER_API_KEY=...   &  set REPO_URL=https://github.com/you/repo
       python deploy_render.py

  B) 只给 Render API Key + GitHub Token（脚本自动建仓库并上传代码）：
       set RENDER_API_KEY=...  &  set GITHUB_TOKEN=ghp_...
       python deploy_render.py

依赖：标准库（urllib）。Windows PowerShell 里用 $env:XXX="..." 设置环境变量。
"""
import base64
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
RENDER_KEY = os.environ.get("RENDER_API_KEY", "").strip()
GH_TOKEN = os.environ.get("GITHUB_TOKEN", "").strip()
REPO_URL = os.environ.get("REPO_URL", "").strip()
OWNER_ID = os.environ.get("RENDER_OWNER_ID", "tea-dbh18t5g1s2s73cghnsg").strip()
SERVICE_NAME = os.environ.get("SERVICE_NAME", "nba-explorer")
REGION = os.environ.get("RENDER_REGION", "singapore")
PLAN = os.environ.get("RENDER_PLAN", "free")

CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE

SKIP_DIRS = {"data/cache", "data/.shots", "__pycache__", ".git", "node_modules"}
SKIP_EXT = {".zip", ".pyc"}
SKIP_FILES = {"start-public.bat"}


def call(method, url, headers, body=None, raw=False):
    data = None
    if body is not None:
        data = body if raw else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, context=CTX, timeout=120) as resp:
            payload = resp.read()
            return resp.status, (payload if raw else json.loads(payload.decode("utf-8") or "null"))
    except urllib.error.HTTPError as e:
        text = e.read().decode("utf-8", "replace")
        return e.code, text


def render_headers():
    return {"Authorization": "Bearer " + RENDER_KEY, "Accept": "application/json",
            "Content-Type": "application/json"}


def gh_headers():
    return {"Authorization": "Bearer " + GH_TOKEN, "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "nba-explorer-deploy"}


def iter_files():
    for dirpath, dirnames, filenames in os.walk(ROOT):
        rel = os.path.relpath(dirpath, ROOT).replace("\\", "/")
        rel = "" if rel == "." else rel
        dirnames[:] = [d for d in dirnames if d not in {"__pycache__", "node_modules", ".git"}]
        if rel:
            if any(rel == s or rel.startswith(s + "/") for s in SKIP_DIRS):
                dirnames[:] = []
                continue
            if rel.startswith("data/cache"):
                dirnames[:] = []
                continue
        for name in filenames:
            if name in SKIP_FILES or os.path.splitext(name)[1].lower() in SKIP_EXT:
                continue
            full = os.path.join(dirpath, name)
            if os.path.getsize(full) > 40 * 1024 * 1024:
                print("  跳过（>40MB）:", full)
                continue
            yield (rel + "/" + name if rel else name), full


def push_to_github():
    global REPO_URL
    status, user = call("GET", "https://api.github.com/user", gh_headers())
    if status != 200:
        sys.exit(f"GitHub Token 无效: {status} {user}")
    login = user["login"]
    repo = SERVICE_NAME
    status, data = call("POST", "https://api.github.com/user/repos", gh_headers(),
                        {"name": repo, "private": False, "auto_init": False,
                         "description": "NBA Explorer - games / players / shot charts"})
    if status == 422:  # 已存在
        print(f"仓库 {login}/{repo} 已存在，直接覆盖文件")
    elif status not in (200, 201):
        sys.exit(f"创建 GitHub 仓库失败: {status} {data}")
    REPO_URL = f"https://github.com/{login}/{repo}"
    print("GitHub 仓库:", REPO_URL)

    # 获取默认分支上已有文件的 sha（覆盖同路径时需要）
    def existing_sha(path):
        st, d = call("GET", f"https://api.github.com/repos/{login}/{repo}/contents/{path}", gh_headers())
        if st == 200 and isinstance(d, dict) and d.get("type") == "file":
            return d.get("sha")
        return None

    count = 0
    for path, full in iter_files():
        with open(full, "rb") as f:
            content = base64.b64encode(f.read()).decode("ascii")
        body = {"message": f"upload {path}", "content": content, "branch": "main"}
        sha = existing_sha(path)
        if sha:
            body["sha"] = sha
        st, d = call("PUT", f"https://api.github.com/repos/{login}/{repo}/contents/{path}",
                     gh_headers(), body)
        if st not in (200, 201):
            print("  上传失败", path, st, str(d)[:200])
        count += 1
        if count % 10 == 0:
            print(f"  已上传 {count} 个文件...")
    print(f"共上传 {count} 个文件")


def create_service():
    body = {
        "type": "web_service",
        "name": SERVICE_NAME,
        "ownerId": OWNER_ID,
        "repo": REPO_URL,
        "branch": "main",
        "autoDeploy": "yes",
        "serviceDetails": {
            "env": "docker",
            "plan": PLAN,
            "region": REGION,
            "healthCheckPath": "/api/meta",
            "envSpecificDetails": {"dockerfilePath": "./Dockerfile"},
            "numInstances": 1,
        },
        "envVars": [
            {"key": "HOST", "value": "0.0.0.0"},
            {"key": "PORT", "value": "8080"},
            {"key": "PYTHONUNBUFFERED", "value": "1"},
        ],
    }
    st, data = call("POST", "https://api.render.com/v1/services", render_headers(), body)
    if st not in (200, 201):
        sys.exit(f"创建 Render 服务失败: {st} {str(data)[:800]}")
    svc = data.get("service", data)
    print("已创建服务:", svc.get("id"), svc.get("name"))
    return svc


def wait_live(service_id, timeout=1200):
    deadline = time.time() + timeout
    last = ""
    while time.time() < deadline:
        st, deploys = call("GET", f"https://api.render.com/v1/services/{service_id}/deploys?limit=1",
                           render_headers())
        if st == 200 and isinstance(deploys, list) and deploys:
            d = deploys[0].get("deploy", deploys[0])
            status = d.get("status")
            line = f"部署状态: {status}  commit={str(d.get('commit', {}).get('id', ''))[:8]}"
            if line != last:
                print(line)
                last = line
            if status == "live":
                return d.get("serviceDetails", {}).get("url") or url_of(service_id)
            if status in ("build_failed", "pre_deploy_failed", "canceled"):
                print("部署失败状态:", status)
                return None
        time.sleep(15)
    return None


def url_of(service_id):
    st, svc = call("GET", f"https://api.render.com/v1/services/{service_id}", render_headers())
    if st == 200:
        s = svc.get("service", svc)
        return (s.get("serviceDetails") or {}).get("url")
    return None


def main():
    if not RENDER_KEY:
        sys.exit("缺少 RENDER_API_KEY")
    st, owners = call("GET", "https://api.render.com/v1/owners", render_headers())
    if st != 200:
        sys.exit(f"Render Key 无效: {st} {owners}")
    print("Render 账户:", owners[0]["owner"]["name"], owners[0]["owner"]["id"])

    global REPO_URL
    if not REPO_URL:
        if not GH_TOKEN:
            sys.exit("请设置 REPO_URL（已有公开仓库）或 GITHUB_TOKEN（自动建仓库并上传）")
        push_to_github()

    svc = create_service()
    url = wait_live(svc["id"])
    if url:
        print("\n部署完成:", url)
        print("体检:", url.rstrip("/") + "/api/meta")
    else:
        print("\n部署超过 15 分钟仍未上线，请到 Render 控制台查看日志。服务 ID:", svc["id"])


if __name__ == "__main__":
    main()
