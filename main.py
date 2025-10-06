import io, zipfile, os
from fastapi import FastAPI, File, UploadFile
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
import numpy as np
import cv2

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def pil_to_cv(img_pil):
    arr = np.array(img_pil.convert("RGB"))
    return cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)

def cv_to_pil(img_cv):
    rgb = cv2.cvtColor(img_cv, cv2.COLOR_BGR2RGB)
    return Image.fromarray(rgb)

@app.post("/api/inpaint-batch")
async def inpaint_batch(images: list[UploadFile] = File(...), masks: list[UploadFile] = File(...)):
    if len(images) != len(masks):
        return JSONResponse({"error":"images and masks count mismatch"}, status_code=400)

    mem_zip = io.BytesIO()
    zf = zipfile.ZipFile(mem_zip, mode="w", compression=zipfile.ZIP_DEFLATED)

    for idx, (img_file, mask_file) in enumerate(zip(images, masks)):
        img_bytes = await img_file.read()
        mask_bytes = await mask_file.read()
        try:
            img_pil = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        except Exception as e:
            continue

        if mask_bytes is None or len(mask_bytes)==0:
            out_io = io.BytesIO()
            img_pil.save(out_io, format="PNG")
            out_io.seek(0)
            fname = f"cleaned-{idx+1}-{os.path.splitext(img_file.filename)[0]}.png"
            zf.writestr(fname, out_io.read())
            continue

        try:
            mask_pil = Image.open(io.BytesIO(mask_bytes)).convert("L")
        except:
            mask_pil = None

        if mask_pil is None:
            out_io = io.BytesIO()
            img_pil.save(out_io, format="PNG")
            out_io.seek(0)
            fname = f"cleaned-{idx+1}-{os.path.splitext(img_file.filename)[0]}.png"
            zf.writestr(fname, out_io.read())
            continue

        img_cv = pil_to_cv(img_pil)
        mask_cv = np.array(mask_pil)
        _, mask_thr = cv2.threshold(mask_cv, 127, 255, cv2.THRESH_BINARY)
        try:
            result_cv = cv2.inpaint(img_cv, mask_thr, inpaintRadius=3, flags=cv2.INPAINT_TELEA)
        except Exception as e:
            result_cv = img_cv

        result_pil = cv_to_pil(result_cv)
        out_io = io.BytesIO()
        result_pil.save(out_io, format="PNG")
        out_io.seek(0)
        fname = f"cleaned-{idx+1}-{os.path.splitext(img_file.filename)[0]}.png"
        zf.writestr(fname, out_io.read())

    zf.close()
    mem_zip.seek(0)
    headers = {
        'Content-Disposition': f'attachment; filename="inpaint_results.zip"'
    }
    return StreamingResponse(mem_zip, media_type="application/zip", headers=headers)