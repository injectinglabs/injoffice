import {useEffect,useRef,useState} from 'react'
import {createDocxWasmClient} from '@injoffice/docx-wasm'
import {createNativeDocxPartialContentPreviewV1,type NativeDocxPartialContentV1,type NativeDocxPartialParagraphV1} from '@injoffice/docs/native-docx'
import {DsButton} from '../design-system/primitives'

function Paragraph({paragraph}:{paragraph:NativeDocxPartialParagraphV1}){
 return <p style={{whiteSpace:'pre-wrap'}}>{paragraph.segments.map((segment,index)=>segment.kind==='omission'?<span key={index}>[{segment.code}]</span>:segment.kind==='alternative-text'?<span key={index}>[Authored drawing description: {segment.text}]</span>:<span key={index}>{segment.text}</span>)}</p>
}
export function NativeDocxPartialTextView({preview}:{preview:NativeDocxPartialContentV1}){
 return <article aria-label="Read-only partial source text">
  <p>Source text only, not Word layout. Table cells are listed in source order; omissions remain labeled. This view cannot edit the document.</p>
  {preview.retained_nontext_diagnostic_ids.length>0&&<p>{preview.retained_nontext_diagnostic_ids.length} source metadata warnings are retained. They do not prevent plain text recovery, but this view does not reproduce their formatting.</p>}
  {preview.blocks.map((block,index)=>block.kind==='paragraph'?<Paragraph key={index} paragraph={block}/>:block.kind==='omission'?<p key={index}>[{block.code}: {block.count}]</p>:<section key={index} aria-label="Table source text"><h5>Table cell text · no table layout</h5>{block.cells.map(cell=><section key={cell.source.scope_id}><h6>Source row {cell.row_ordinal+1}, cell {cell.cell_ordinal+1}</h6>{cell.paragraphs.map((paragraph,n)=>paragraph.kind==='paragraph'?<Paragraph key={n} paragraph={paragraph}/>:<p key={n}>[{paragraph.code}]</p>)}</section>)}</section>)}
 </article>
}

/** Separate opt-in browser operation, including while editing in server mode. */
export function NativeDocxPartialText({bytes,packageDigest}:{bytes:Uint8Array;packageDigest:string}){
 const active=useRef<AbortController|null>(null)
 const [result,setResult]=useState<NativeDocxPartialContentV1|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('')
 useEffect(()=>{active.current?.abort();active.current=null;setResult(null);setBusy(false);setError('');return()=>{active.current?.abort();active.current=null}},[bytes,packageDigest])
 const run=async()=>{
  const controller=new AbortController();active.current?.abort();active.current=controller
  setBusy(true);setError('');setResult(null)
  let client:ReturnType<typeof createDocxWasmClient>|undefined
  try{
   client=createDocxWasmClient()
   const joined=await client.inspectPartialContent(bytes,{signal:controller.signal})
   if(joined.document.source.package_sha256!==packageDigest)throw new Error('Source changed; reopen the partial text preview.')
   const preview=createNativeDocxPartialContentPreviewV1(joined.document,{policy:'source-text-with-omissions-v1',read_only:true},joined.resolved_layout)
   if(active.current===controller&&!controller.signal.aborted)setResult(preview)
  }catch(reason){if(active.current===controller&&!controller.signal.aborted)setError(reason instanceof Error?reason.message:'Partial source text could not be qualified.')}
  finally{client?.terminate();if(active.current===controller){active.current=null;setBusy(false)}}
 }
 return <section aria-label="Browser-local read-only partial text">
  <p>This optional text-only view resolves source styles in your browser. No file is uploaded, including when the editor uses server mode.</p>
  <DsButton disabled={busy} onClick={()=>void run()}>Show read-only partial text</DsButton>
  {busy&&<DsButton onClick={()=>{active.current?.abort();active.current=null;setBusy(false)}}>Cancel partial text</DsButton>}
  {busy&&<p role="status">Reading source text in the browser…</p>}
  {error&&<p role="status">{error}</p>}
  {result?.source.package_sha256===packageDigest&&<NativeDocxPartialTextView preview={result}/>}
 </section>
}
