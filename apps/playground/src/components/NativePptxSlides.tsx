import {useEffect,useId,useRef,useState,type ReactNode} from 'react'
import {decodePptxPreview,type PptxPreview,type PreviewNode} from '../../../pptx-page-paint-worker/src/contract'
import {readNativePreviewResponse} from './NativeDocxPages'
import {DsButton,DsField,DsSelect} from '../design-system/primitives'

export function NativePptxVector({preview}:{preview:PptxPreview}){
 const prefix=useId().replace(/:/g,'')
 const color=(value:string)=>value==='none'?'none':`#${value}`
 function draw(node:PreviewNode,key:string):ReactNode{
  switch(node.kind){
   case 'group':{const clip=node.clip,id=`${prefix}-${key}`;return <g key={key} transform={`matrix(${node.transform.join(' ')})`}>
    {clip&&<defs><clipPath id={id}><rect x={clip.x} y={clip.y} width={clip.cx} height={clip.cy}/></clipPath></defs>}
    <g clipPath={clip?`url(#${id})`:undefined}>{node.children.map((child,i)=>draw(child,`${key}-${i}`))}</g>
   </g>}
   case 'path':return <path key={key} d={node.d} fill={color(node.fill)} stroke={node.stroke?color(node.stroke):undefined} strokeWidth={node.strokeWidth}/>
   case 'rect':return <rect key={key} x={node.rect.x} y={node.rect.y} width={node.rect.cx} height={node.rect.cy} rx={node.radius} fill={color(node.fill)} stroke={node.stroke?color(node.stroke):undefined} strokeWidth={node.strokeWidth}/>
   case 'ellipse':return <ellipse key={key} cx={node.rect.x+node.rect.cx/2} cy={node.rect.y+node.rect.cy/2} rx={node.rect.cx/2} ry={node.rect.cy/2} fill={color(node.fill)} stroke={node.stroke?color(node.stroke):undefined} strokeWidth={node.strokeWidth}/>
   case 'placeholder':return <g key={key}><rect x={node.rect.x} y={node.rect.y} width={node.rect.cx} height={node.rect.cy} fill="#eee" stroke="#777" strokeWidth={12700}/><text x={node.rect.x+12700} y={node.rect.y+127000} fontSize={101600}>{node.label}</text></g>
  }
 }
 return <svg role="img" aria-label={`Measured native slide ${preview.slide_index+1}`} viewBox={`0 0 ${preview.width} ${preview.height}`} style={{display:'block',width:'100%',background:color(preview.background),border:'1px solid var(--ds-line)'}}>{preview.nodes.map((node,i)=>draw(node,String(i)))}</svg>
}

export function NativePptxSlides({bytes,slideCount,apiBase}:{bytes:Uint8Array;slideCount:number;apiBase:string}){
 const [paint,setPaint]=useState<PptxPreview|null>(null),[busy,setBusy]=useState(false),[at,setAt]=useState(0)
 const consent=`Native slides require uploading this presentation to ${apiBase}. Nothing is uploaded until you choose the button below.`
 const [message,setMessage]=useState(consent)
 const generation=useRef(0),pending=useRef<AbortController|null>(null)
 useEffect(()=>{generation.current++;pending.current?.abort();setPaint(null);setBusy(false);setAt(0);setMessage(consent);return()=>{generation.current++;pending.current?.abort()}},[bytes,apiBase])
 async function render(){
  const token=++generation.current,controller=new AbortController();pending.current=controller
  setBusy(true);setPaint(null);setMessage('Shaping this slide with exact operator-provided font bytes…')
  try{
   const owned=Uint8Array.from(bytes),hash=await crypto.subtle.digest('SHA-256',owned.buffer),digest=[...new Uint8Array(hash)].map(n=>n.toString(16).padStart(2,'0')).join('')
   if(controller.signal.aborted||token!==generation.current)return
   const response=await fetch(`${apiBase}/v1/pptx/slide-preview?slide=${at}`,{method:'POST',headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.presentationml.presentation'},body:new Blob([owned.buffer]),credentials:'omit',redirect:'error',signal:controller.signal})
   const result=await readNativePreviewResponse(response)
   if(!response.ok)throw new Error(typeof (result as {error?:unknown})?.error==='string'?(result as {error:string}).error:'Native slide preview was refused by the helper.')
   const decoded=decodePptxPreview(result)
   if(decoded.package_sha256!==digest||decoded.slide_index!==at||decoded.slide_count!==slideCount)throw new Error('Native slide does not match the opened source.')
   if(controller.signal.aborted||token!==generation.current)return
   setPaint(decoded);setMessage('Measured native glyphs. Mixed-font line boxes and anchors use the explicit InjOffice policy, not Office pixel-equivalence. Read-only; the source file is unchanged.')
  }catch(error){if(!controller.signal.aborted&&token===generation.current)setMessage(`${error instanceof Error?error.message:'Native preview failed'} The file preview remains available; the original file is unchanged.`)}
  finally{if(token===generation.current)setBusy(false)}
 }
 function changeSlide(index:number){generation.current++;pending.current?.abort();setBusy(false);setPaint(null);setAt(index);setMessage(consent)}
 return <section aria-label="Measured native presentation" className="ds-panel">
  <h3>Measured native slide</h3><p className="ds-status" role="status">{message}</p>
  <div className="ds-workstrip"><DsField label="Native slide"><DsSelect value={at} onChange={event=>changeSlide(Number(event.target.value))}>{Array.from({length:Math.min(slideCount,10000)},(_,i)=><option key={i} value={i}>{i+1} of {slideCount}</option>)}</DsSelect></DsField>
  <DsButton disabled={busy} onClick={()=>void render()}>{busy?'Rendering native slide…':'Upload to helper and render native slide'}</DsButton></div>
  {paint&&<><NativePptxVector preview={paint}/><details open><summary>Native preview limits ({paint.diagnostics.length})</summary><ul>{paint.diagnostics.map((message,i)=><li key={i}>{message}</li>)}</ul></details></>}
 </section>
}
