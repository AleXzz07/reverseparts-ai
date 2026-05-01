FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV FREECAD_PYTHON_PATH=/usr/lib/freecad/lib
ENV PYTHONPATH=/usr/lib/freecad/lib:/usr/lib/freecad/Ext:/usr/lib/python3/dist-packages

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      python3 \
      python3-pip \
      python3-setuptools \
      python3-wheel \
      ca-certificates \
      libgl1 \
      libglu1-mesa \
      freecad-python3 \
      freecad \
      python3-pivy \
    && rm -rf /var/lib/apt/lists/*

RUN apt-get update \
    && (apt-get install -y --no-install-recommends opencascade-tools || true) \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

RUN python3 - <<'PY'
import sys
sys.path.extend(["/usr/lib/freecad/lib", "/usr/lib/freecad/Ext", "/usr/lib/python3/dist-packages"])
import FreeCAD
import Part
print("FreeCAD import OK", FreeCAD.Version())
PY

COPY app.py .

EXPOSE 8000

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
