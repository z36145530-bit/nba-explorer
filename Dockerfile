FROM python:3.12-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    HOST=0.0.0.0 \
    PORT=8080

COPY . .
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD python -c "import urllib.request,os;urllib.request.urlopen('http://127.0.0.1:%s/api/meta'%os.environ.get('PORT','8080')).read()"

CMD ["python", "server.py"]
