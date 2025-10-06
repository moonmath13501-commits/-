import React, { useState, useRef, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import axios from 'axios';

const API_BASE = process.env.REACT_APP_API_URL || ''; // 배포 후 백엔드 URL을 이 변수로 설정

function Thumb({ file, idx, selected, onClick }) {
  return (
    <img
      src={URL.createObjectURL(file)}
      alt={file.name}
      style={{
        width: 84,
        height: 84,
        objectFit: 'cover',
        borderRadius: 6,
        border: selected ? '3px solid #2b6cb0' : '1px solid #ddd',
        marginRight: 8
      }}
      onClick={() => onClick(idx)}
    />
  );
}

function DrawCanvas({ file, onMaskReady }) {
  const canvasRef = useRef();
  const imgRef = useRef();
  const [paths, setPaths] = useState([]);
  const [drawing, setDrawing] = useState(false);

  useEffect(() => {
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      const c = canvasRef.current;
      c.width = img.width;
      c.height = img.height;
      c.style.width = '100%';
      c.style.height = 'auto';
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
    };
    img.src = URL.createObjectURL(file);
  }, [file]);

  const getPos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const x = ((clientX - rect.left) * canvasRef.current.width) / rect.width;
    const y = ((clientY - rect.top) * canvasRef.current.height) / rect.height;
    return { x, y };
  };

  const start = (e) => {
    e.preventDefault();
    setDrawing(true);
    const p = getPos(e);
    setPaths(prev => [...prev, [p]]);
  };
  const move = (e) => {
    if (!drawing) return;
    e.preventDefault();
    const p = getPos(e);
    setPaths(prev => {
      const copy = prev.slice(0, -1);
      const last = prev[prev.length - 1].slice();
      last.push(p);
      return [...copy, last];
    });
  };
  const end = (e) => {
    e && e.preventDefault();
    setDrawing(false);
  };

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !imgRef.current) return;
    const ctx = c.getContext('2d');
    ctx.clearRect(0,0,c.width,c.height);
    ctx.drawImage(imgRef.current, 0, 0);
    ctx.fillStyle = 'rgba(255,0,0,0.35)';
    ctx.strokeStyle = 'rgba(255,0,0,0.9)';
    ctx.lineWidth = Math.max(12, c.width * 0.01);
    paths.forEach(path => {
      if (path.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(path[0].x, path[0].y);
      for (let i=1;i<path.length;i++) ctx.lineTo(path[i].x, path[i].y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    });
  }, [paths]);

  const makeMaskBlob = async () => {
    const c = canvasRef.current;
    const mask = document.createElement('canvas');
    mask.width = c.width;
    mask.height = c.height;
    const mctx = mask.getContext('2d');
    mctx.fillStyle = 'black';
    mctx.fillRect(0,0,mask.width, mask.height);
    mctx.fillStyle = 'white';
    paths.forEach(path => {
      if (path.length <2) return;
      mctx.beginPath();
      mctx.moveTo(path[0].x, path[0].y);
      for (let i=1;i<path.length;i++) mctx.lineTo(path[i].x, path[i].y);
      mctx.closePath();
      mctx.fill();
    });
    const blob = await new Promise(r => mask.toBlob(r, 'image/png'));
    return blob;
  };

  const resetMask = () => setPaths([]);

  return (
    <div>
      <div style={{position:'relative', width:'100%', border:'1px solid #ddd', borderRadius:8, overflow:'hidden'}}>
        <canvas
          ref={canvasRef}
          style={{ touchAction:'none', display:'block', width:'100%' }}
          onMouseDown={start}
          onMouseMove={move}
          onMouseUp={end}
          onMouseLeave={end}
          onTouchStart={start}
          onTouchMove={move}
          onTouchEnd={end}
        />
      </div>
      <div style={{display:'flex', gap:8, marginTop:8}}>
        <button onClick={async ()=>{
          const maskBlob = await makeMaskBlob();
          onMaskReady(maskBlob);
        }}>마스크 저장(이 이미지)</button>
        <button onClick={resetMask}>다시 그리기</button>
      </div>
    </div>
  );
}

export default function App(){
  const [files, setFiles] = useState([]);
  const [current, setCurrent] = useState(0);
  const [masks, setMasks] = useState({});
  const [processing, setProcessing] = useState(false);

  const onDrop = (accepted) => {
    setFiles(accepted);
    setCurrent(0);
    setMasks({});
  };
  const {getRootProps, getInputProps} = useDropzone({onDrop, accept:{'image/*':[]}, multiple:true});

  const saveMaskFor = (idx, blob) => {
    setMasks(prev => ({...prev, [idx]: blob}));
    alert('이 이미지의 마스크가 저장되었습니다.');
  };

  const sendAllAndDownloadZip = async () => {
    if (files.length===0) { alert('먼저 사진을 업로드하세요.'); return; }
    const fd = new FormData();
    files.forEach((f, i) => {
      fd.append('images', f, f.name);
      if (masks[i]) {
        fd.append('masks', masks[i], `mask-${i}.png`);
      } else {
        const blobEmpty = new Blob([new Uint8Array([])], {type:'application/octet-stream'});
        fd.append('masks', blobEmpty, `mask-${i}.png`);
      }
    });

    try {
      setProcessing(true);
      const url = (API_BASE || '') + '/api/inpaint-batch';
      const res = await axios.post(url, fd, {
        responseType: 'blob',
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      const blob = res.data;
      const link = document.createElement('a');
      const urlBlob = URL.createObjectURL(blob);
      link.href = urlBlob;
      link.download = `inpaint_result_${new Date().toISOString().slice(0,10)}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(urlBlob);
      alert('ZIP 파일이 다운로드 되었습니다. 파일을 열어 갤러리에 저장하세요.');
    } catch (err) {
      console.error(err);
      alert('처리 중 오류가 발생했습니다.');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div style={{maxWidth:820, margin:'auto', padding:16}}>
      <h2>말풍선 글자 지우기 (안드로이드용 웹 앱)</h2>
      <div {...getRootProps()} style={{border:'2px dashed #ccc', padding:18, borderRadius:8}}>
        <input {...getInputProps()} />
        <p>여기를 탭하거나 파일을 드래그하세요. (휴대폰: 앨범에서 여러 장 선택)</p>
      </div>

      {files.length>0 && (
        <>
          <div style={{display:'flex', overflowX:'auto', marginTop:12, paddingBottom:8}}>
            {files.map((f,i)=>(
              <div key={i} onClick={()=>setCurrent(i)}>
                <Thumb file={f} idx={i} selected={i===current} onClick={setCurrent} />
              </div>
            ))}
          </div>

          <div style={{marginTop:12}}>
            <h4>이미지 #{current+1}: {files[current].name}</h4>
            <DrawCanvas file={files[current]} onMaskReady={(blob)=>saveMaskFor(current, blob)} />
          </div>

          <div style={{marginTop:12}}>
            <p>모든 이미지의 마스크를 저장한 뒤 아래 버튼을 눌러 한 번에 처리하세요. (마스크가 없는 이미지는 변경 없음)</p>
            <button onClick={sendAllAndDownloadZip} disabled={processing}>
              {processing ? '처리중...' : '한꺼번에 처리해서 ZIP 다운로드'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}