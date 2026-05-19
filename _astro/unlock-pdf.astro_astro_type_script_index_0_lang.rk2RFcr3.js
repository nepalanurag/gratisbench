import{P as g}from"./PDFButton.NuyF0E2o.js";import{s as k}from"./pdf-render.DYKIfUTr.js";import{e as d,s as P,a as f,f as u,h as w,b as m,d as b}from"./common.C1JoWam1.js";import"./_commonjsHelpers.Cpj98o6Y.js";import"./preload-helper.BlTxHScW.js";const _="https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.mjs",E="pypdf==6.19.0",v=18e4,D=`
from pypdf import PdfReader, PdfWriter
import io

reader = PdfReader(io.BytesIO(bytes(pdf_data_in)))
if reader.is_encrypted:
    ok = reader.decrypt(pdf_password)
    if not ok:
        # Some files only restrict the owner; a blank password opens those.
        ok = reader.decrypt("")
    if not ok:
        raise ValueError("wrong-password")
writer = PdfWriter()
for page in reader.pages:
    writer.add_page(page)
buf = io.BytesIO()
writer.write(buf)
pdf_data_out = buf.getvalue()
`;let c=null;function T(){return new Error("The unlock engine took too long to download. Check your connection and try again.")}function C(a){c||(c=(async()=>{a?.("Downloading the unlock engine (one-time)…");const{loadPyodide:e}=await import(_),t=await e();return a?.("Preparing the unlock engine…"),await t.loadPackage("micropip"),await t.pyimport("micropip").install(E),t})(),c.catch(()=>{c=null}));const i=c,r=new Promise((e,t)=>{const o=setTimeout(()=>t(T()),v);i.then(n=>{clearTimeout(o)},()=>{clearTimeout(o)})});return Promise.race([i,r])}async function O(a,i,r){const e=await C(r);e.globals.set("pdf_data_in",a),e.globals.set("pdf_password",i);try{e.runPython(D)}catch(o){throw o instanceof Error&&o.message.includes("wrong-password")?new Error("WRONG_PASSWORD"):o}const t=e.globals.get("pdf_data_out");try{return t.toJs()}finally{t.destroy()}}function x(){const a=d("pass-input"),i=d("unlock-btn"),r=d("result");let e=null;function t(){w("error-box"),r.hidden=!0,i.disabled=!e}P("dropzone","file-input",o=>{const n=o.find(s=>s.type==="application/pdf"||s.name.toLowerCase().endsWith(".pdf"));if(!n){f("error-box","That is not a PDF file.");return}e=n,d("file-label").textContent=`${n.name} · ${u(n.size)}`,t()}),a.addEventListener("input",t),i.addEventListener("click",async()=>{if(!e)return;w("error-box"),r.hidden=!0;const o=d("engine-status");m("unlock-btn",!0,"Unlocking…");try{await new Promise(l=>setTimeout(l,30));const n=new Uint8Array(await e.arrayBuffer()),s=await O(n,a.value,l=>{o.textContent=l});o.textContent="";const p=(await g.load(s)).getPageCount(),y=e.name.replace(/\.pdf$/i,"");d("result-info").textContent=`${u(s.length)} · ${p} page${p===1?"":"s"} · opens with no password`;const h=d("download-btn");h.onclick=()=>b(`${y}-unlocked.pdf`,s,"application/pdf"),k("preview-wrap",s),r.hidden=!1,r.scrollIntoView({behavior:"smooth",block:"nearest"})}catch(n){o.textContent="",f("error-box",n instanceof Error&&n.message==="WRONG_PASSWORD"?"That password did not work for this file. Check for typos and try again.":n instanceof Error?n.message:"Unlocking failed.")}finally{m("unlock-btn",!1)}}),t()}x();
