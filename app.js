import {
  FORMATS, MATCH_MODES, VARIABLE_MODES, PALETTE, lineSymbols, symbolBoundaryRaw,
  rawRangeToSymbols, nearestSymbolBoundary, findMatches, convertField, analyze, toBits,
  validateProject, splitPackets, convertPackets, compareUnits, packetDelimiter, mergeFieldRuns
} from './engine.js';

const $=id=>document.getElementById(id);
const ui={
  input:$('packetInput'),box:$('textBox'),stage:$('editorStage'),layer:$('fieldLayer'),
  gutter:$('gutter'),gutterItems:$('gutterItems'),dropLine:$('dropLine'),
  reorderLayer:$('reorderLayer'),context:$('contextMenu'),toast:$('toast'),
  format:$('formatSelect'),delimiter:$('delimiterInput'),min:$('minWidth'),variable:$('variableSelect'),
  lensIcon:$('lensIcon'),lensGlyph:$('lensGlyph'),lensState:$('lensState'),
  lensLabel:$('lensLabel'),lensDesc:$('lensDescription'),lensHelp:$('lensHelp'),
  groupsList:$('groupsList'),track:$('bitTrack'),results:$('fieldResults'),
  dialog:$('convertDialog'),conversion:$('conversionResult'),fileInput:$('fileOpen')
};
// Deliberately synthetic frames: two families, fixed delimiters, shifting fields,
// an offset header, and a repeated trailer. Demonstrates Aligned and Anywhere.
const DEMO=[
  'A55A82930000C0DE',
  'A55A82A20000C0DE',
  'A55A82800000C0DE',
  'A55A85810000C0DE',
  'A55A85800000C0DE',
  'A55A82930001C0DE',
  'A55A82A24000C0DE',
  '7EA55A82930000C0DE',
  '7E7EA55A82A20000C0DE',
  'A55A85811000C0DE',
  'A55A829380005AA5',
  'A55A858080005AA5'
].join('\n');

let candidate=null,editingId=null,groups=[],nextId=1,matchMode='Aligned';
let savedHitMap=new Map(),previewHits=[],lineColors=new Map();
let drag=null,reorder=null,pointerSelect=null,skipSelection=false,selectionLocked=false,nativeSelectMode=false;
let pendingRender=0,analysisTimer=0,toastTimer=0,convText='';
let charWidth=8.43,rowH=38,padTop=22,padLeft=22;
let lastSelectionKey='',lastSnap=-1,currentFileName='nibbler-project.nibbler.json';
const THEMES=['modern','contrast','light','dark','y2k','aero','glass','saturated'];
// Presentation-only colour families. Group IDs retain a stable colour identity
// across themes; exported project colours are never rewritten by theme changes.
const THEME_FIELD_PALETTES={
  dark:[['#1b5047','#96e0c3'],['#624329','#f0ba88'],['#24475d','#a6d9fa'],['#45472a','#e2e5a1'],['#603d48','#f1afc5'],['#31534d','#b2e9d7'],['#654d27','#eed49a'],['#2d5264','#a0ddf4']],
  contrast:[['#135d45','#a1ffe3'],['#663814','#ffe3a5'],['#1e4f83','#d2eaff'],['#50510c','#f4ff94'],['#66335b','#ffccf4'],['#155c62','#a7f7ff'],['#675016','#fff1a8'],['#3c4680','#d8d1ff']],
  light:[['#b3e3d4','#096756'],['#ffdfc5','#965025'],['#d8e8ff','#325d91'],['#e7edba','#626f22'],['#ffdde4','#943c61'],['#c8eee9','#166e72'],['#f7e5c3','#8b591f'],['#dce1f7','#4f568a']],
  y2k:[['#8aaf16','#edff2d'],['#235914','#b6ff35'],['#506519','#efff73'],['#235b2c','#a0ff58'],['#626016','#e7fa5f'],['#155e3a','#a1ffc0'],['#5b6717','#cefa43'],['#385e10','#c4ff78']],
  aero:[['#1c9ab8','#96ebff'],['#1f9767','#89ffc0'],['#bc771c','#ffe08b'],['#3176bd','#a5daff'],['#c5698c','#ffb9da'],['#219590','#9efff4'],['#9e7930','#ffefaf'],['#5689bd','#c7e2ff']],
  glass:[['#2b7594','#aceeff'],['#287e75','#8efce1'],['#625e9a','#d3c9ff'],['#985468','#ffb9d5'],['#8d6b3d','#ffe0a3'],['#327eaf','#aad9ff'],['#557d77','#c2ffe7'],['#806c9b','#e9caff']],
  saturated:[['#0d8f91','#5ffff1'],['#a54b3f','#ffbb83'],['#304dc1','#c1d1ff'],['#9364ae','#ffbaff'],['#568d24','#dbff79'],['#ad2c73','#ffc0db'],['#ab7830','#ffe68c'],['#1985be','#9bffff']]
};
function displayGroupColors(id,original){
  const theme=document.documentElement.dataset.theme||'modern';
  const palette=THEME_FIELD_PALETTES[theme];
  if(!palette)return original;
  return palette[(Math.max(1,Number(id)||1)-1)%palette.length];
}
function setTheme(value){
  const theme=THEMES.includes(value)?value:'modern';
  document.documentElement.dataset.theme=theme;
  $('themeSelect').value=theme;
  try{localStorage.setItem('nibbler-theme',theme);}catch{}
  const meta=document.querySelector('meta[name="theme-color"]');
  if(meta)meta.content=getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()||'#101b20';
  scheduleRender();
}
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const rows=()=>ui.input.value.replace(/\r/g,'').split('\n');
const format=()=>ui.format.value;
const indexFor=(line,column,lines=rows())=>lines.slice(0,line).reduce((n,s)=>n+s.length+1,0)+column;

function metrics(){
  const comp=getComputedStyle(ui.input);
  const canvas=document.createElement('canvas');const ctx=canvas.getContext('2d');ctx.font=`${comp.fontWeight} ${comp.fontSize} ${comp.fontFamily}`;
  const letterSpacing=parseFloat(comp.letterSpacing)||0;
  charWidth=ctx.measureText('0').width+letterSpacing;
  rowH=parseFloat(comp.lineHeight)||38;
  padTop=parseFloat(comp.paddingTop)||22;padLeft=parseFloat(comp.paddingLeft)||22;
}
function toast(message){
  ui.toast.textContent=message;ui.toast.classList.add('visible');clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>ui.toast.classList.remove('visible'),2650);
}
function candidateColor(){
  if(editingId!==null){const g=groups.find(g=>g.id===editingId);if(g)return displayGroupColors(g.id,[g.color,g.accent]);}
  return displayGroupColors(nextId,PALETTE[(nextId-1)%PALETTE.length]);
}
function selectedNeedle(c=candidate){
  if(!c||c.start===c.end)return '';
  const data=lineSymbols(rows()[c.line]||'',format()).value;
  return data.slice(c.start,c.end);
}
function selectionForCandidate(){
  if(!candidate)return [];
  const needle=selectedNeedle();
  return findMatches(rows(),format(),needle,candidate.start,candidate.mode);
}
function groupFor(id){return groups.find(g=>g.id===id);}
function scheduleRender(){if(pendingRender)return;pendingRender=requestAnimationFrame(()=>{pendingRender=0;drawAll();});}
function scheduleAnalysis(){clearTimeout(analysisTimer);analysisTimer=setTimeout(drawAnalysis,90);}
function refresh(){scheduleRender();scheduleAnalysis();}
function drawAll(){
  metrics();savedHitMap=new Map();lineColors=new Map();
  const ls=rows();
  for(const g of groups){
    if(g.encoding!==format())continue;
    const hits=findMatches(ls,g.encoding,g.needle,g.offset,g.mode);
    savedHitMap.set(g.id,hits);
    if(g.id!==editingId)for(const hit of hits)lineColors.set(hit.line,displayGroupColors(g.id,[g.color,g.accent])[1]);
  }
  previewHits=selectionForCandidate();
  if(candidate){const accent=candidateColor()[1];for(const m of previewHits)lineColors.set(m.line,accent);}
  $('packetCount').textContent=ls.filter(s=>s.trim()).length;
  $('groupCount').textContent=groups.length;
  renderFields();drawGutter();drawRuler();drawLens();drawGroups();
}
function makeField(hit,group,isDraft,source=false,snap=false){
  const [tone,accent]=isDraft?candidateColor():displayGroupColors(group.id,[group.color,group.accent]);
  const el=document.createElement('div');
  el.className=`field ${isDraft?'draft':'saved'}${source?' is-anchor':''}${snap?' snap':''}`;
  el.style.setProperty('--tone',tone);el.style.setProperty('--accent',accent);
  el.dataset.type=isDraft?'draft':'saved';if(!isDraft)el.dataset.group=String(group.id);
  el.dataset.line=hit.line;el.dataset.start=hit.symbolStart;el.dataset.end=hit.symbolEnd;
  const y=padTop+hit.line*rowH-ui.input.scrollTop;
  const x=padLeft+hit.rawStart*charWidth-ui.input.scrollLeft;
  const w=Math.max(2,(hit.rawEnd-hit.rawStart)*charWidth);
  // Small outboard border: field rails never sit directly on edge glyphs.
  el.style.left=`${x-1}px`;el.style.top=`${y-1}px`;el.style.width=`${w+4}px`;el.style.height=`${rowH+2}px`;
  if(isDraft){
    for(const side of ['left','right']){
      const grip=document.createElement('div');grip.className='field-grip';grip.dataset.side=side;
      grip.innerHTML='<span class="grip-bars"><i></i><i></i><i></i></span>';
      el.append(grip);
    }
  }
  return el;
}
function renderFields(){
  if(reorder)return;
  const frag=document.createDocumentFragment();
  const minLine=Math.max(0,Math.floor((ui.input.scrollTop-padTop)/rowH)-1);
  const maxLine=Math.ceil((ui.input.scrollTop+ui.input.clientHeight-padTop)/rowH)+1;
  let count=0;
  for(const group of groups){
    if(group.id===editingId || group.encoding!==format())continue;
    for(const hit of savedHitMap.get(group.id)||[]){
      if(hit.line<minLine||hit.line>maxLine||++count>2200)continue;
      frag.append(makeField(hit,group,false));
    }
  }
  const now=performance.now();
  for(const hit of previewHits){
    if(hit.line<minLine||hit.line>maxLine||++count>2500)continue;
    frag.append(makeField(hit,null,true,!!(candidate&&hit.line===candidate.line&&hit.symbolStart===candidate.start),now-lastSnap<170));
  }
  if(candidate&&candidate.width===0){
    const {positions}=lineSymbols(rows()[candidate.line]||'',format());
    const raw=symbolBoundaryRaw(positions,candidate.start);
    const stub=makeField({line:candidate.line,rawStart:raw,rawEnd:raw,symbolStart:candidate.start,symbolEnd:candidate.end},null,true,true);
    stub.classList.add('collapse');frag.append(stub);
  }
  ui.layer.replaceChildren(frag);

}
function makeGutterRow(lineNum,visualIndex,id=null){
  const el=document.createElement('div');el.className='gutter-row';
  el.dataset.gutterId=id??String(lineNum);
  el.style.top=`${padTop+visualIndex*rowH-ui.input.scrollTop}px`;
  const c=lineColors.get(lineNum);
  if(c){const marker=document.createElement('span');marker.className='gutter-marker';marker.style.setProperty('--tone',c);el.append(marker);}
  const label=document.createElement('span');label.className='gutter-num';label.textContent=String(visualIndex+1).padStart(2,'0');
  el.append(label);
  const grip=document.createElement('span');grip.className='gutter-grip';grip.textContent='⋮⋮';el.append(grip);
  return el;
}
function drawGutter(){
  if(reorder)return;
  const ls=rows(),frag=document.createDocumentFragment();
  const minLine=Math.max(0,Math.floor((ui.input.scrollTop-padTop)/rowH)-1),maxLine=Math.min(ls.length-1,Math.ceil((ui.input.scrollTop+ui.input.clientHeight-padTop)/rowH)+1);
  for(let i=minLine;i<=maxLine;i++)frag.append(makeGutterRow(i,i));
  ui.gutterItems.replaceChildren(frag);
}
function drawRuler(){
  const el=$('rulerTicks');if(!el)return;
  const left=ui.input.scrollLeft,width=ui.box.clientWidth;
  const first=Math.max(0,Math.floor((left-padLeft)/(4*charWidth))*4);
  const last=Math.ceil((left+width-padLeft)/(4*charWidth))*4;
  const frag=document.createDocumentFragment();
  for(let col=first;col<=Math.min(last,512);col+=4){
    const tick=document.createElement('span');tick.className='ruler-tick';
    tick.style.left=`${padLeft+col*charWidth-left}px`;
    tick.textContent=String(col);frag.append(tick);
  }
  el.replaceChildren(frag);
}
function drawLens(){
  const active=candidate;const c=active?candidateColor():null;
  if(!active){
    ui.lensIcon.style.background='';ui.lensGlyph.textContent='⌁';ui.lensState.textContent='No active selection';
    ui.lensLabel.textContent='Select a field';ui.lensDesc.textContent='Drag over a sequence to see where it repeats.';
    $('fieldWidth').textContent='—';$('fieldOffset').textContent='—';$('matchCount').textContent='—';
    ui.lensHelp.innerHTML='The coloured field is a live preview. <b>Right-click → Save as group</b> to keep it.';
    return;
  }
  ui.lensIcon.style.background=c[1];ui.lensGlyph.textContent=active.width?'▥':'│';
  ui.lensState.textContent=editingId!==null?`EDITING ${groupFor(editingId)?.label??'GROUP'} · UNSAVED`:'PREVIEW ONLY · NOT SAVED';
  ui.lensLabel.textContent=active.width?selectedNeedle():'Empty field';
  ui.lensDesc.textContent=active.width?`${active.width} ${format()==='Hex'?'nibbles':format()==='Binary'?'bits':'characters'} · ${active.mode.toLowerCase()} matching`:'Drag an edge beyond the other to reverse it, or save to delete this group.';
  $('fieldWidth').textContent=String(active.width);
  $('fieldOffset').textContent=`${active.start}`;$('matchCount').textContent=String(previewHits.length);
  ui.lensHelp.innerHTML=editingId!==null?'Right-click the highlighted field and choose <b>Save changes</b>. Escape discards edits.':
    'Grab <b>any coloured match</b> to move the field. Resize from either thin edge. <b>Right-click to save.</b>';
}
function drawGroups(){
  $('groupNumber').textContent=String(groups.length).padStart(2,'0');
  if(!groups.length){ui.groupsList.innerHTML='<div class="empty-groups"><div class="empty-art">◫</div><strong>No saved fields</strong><span>Right-click a selection and choose Save as group.</span></div>';return;}
  const frag=document.createDocumentFragment();
  groups.forEach(g=>{
    const r=document.createElement('div');r.className='group-row';r.tabIndex=0;r.role='button';
    const available=g.encoding===format();
    r.title=available?`Edit ${g.label} — ${g.needle}`:`${g.label} is saved in ${g.encoding}. Convert packet values back to that format to reactivate.`;r.dataset.groupId=g.id;
    r.classList.toggle('unavailable',!available);
    const hits=savedHitMap.get(g.id)?.length??0;
    r.innerHTML=`<span class="group-swatch"></span><span class="group-detail"><strong></strong><small></small></span><span class="group-hits"></span><span class="group-edit" aria-hidden="true">↗</span>`;
    r.style.setProperty('--accent',displayGroupColors(g.id,[g.color,g.accent])[1]);r.querySelector('strong').textContent=g.label;
    r.querySelector('small').textContent=`${g.needle} · ${g.encoding}${available?'':' · INACTIVE'}`;
    r.querySelector('.group-hits').textContent=`${hits}×`;
    r.addEventListener('click',()=>available?beginEdit(g.id):toast(`${g.label} uses ${g.encoding}. Convert packet values to ${g.encoding} to edit.`));
    r.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();available?beginEdit(g.id):toast(`${g.label} uses ${g.encoding}`);}});
    r.addEventListener('contextmenu',e=>{e.preventDefault();groupMenu(e,g.id);});
    frag.append(r);
  });
  ui.groupsList.replaceChildren(frag);
}
function drawAnalysis(){
  const lines=rows(),kind=format();
  const detailed=analyze(lines,kind,clamp(Number(ui.min.value)||2,1,128),ui.variable.value);
  const view=compareUnits(lines,kind);
  const err=detailed.error||view.error;
  $('comparisonUnit').textContent=view.heading;
  $('stableUnitLabel').textContent=view.plural;
  $('variableUnitLabel').textContent=view.plural;
  $('stableCount').textContent=String(view.stable);
  $('variableCount').textContent=String(view.variable);
  $('analysisState').textContent=err?'INVALID INPUT':view.valid>=2?'COMPARING':'NEED 2+ ROWS';
  $('analysisState').classList.toggle('active',!err&&view.valid>=2);
  ui.track.replaceChildren();ui.results.replaceChildren();
  const frag=document.createDocumentFragment();
  const displayLimit=kind==='Binary'?192:kind==='Hex'?80:80;
  // Consecutive cells with the same comparison behaviour form one visible band.
  // Each underlying byte/bit remains individually inspectable within its band.
  const shown=view.units.slice(0,displayLimit);
  for(let i=0;i<shown.length;){
    const stable=shown[i].stable,first=shown[i].index;
    let j=i+1;while(j<shown.length&&shown[j].stable===stable)j++;
    const band=document.createElement('div');band.className=`unit-run ${stable?'stable':'variable'}`;
    band.title=`${stable?'Unchanged':'Changing'} ${view.plural} ${first}–${shown[j-1].index}`;
    const tag=document.createElement('span');tag.className='unit-run-label';
    tag.textContent=`${stable?'SAME':'DIFFERENT'} · ${j-i}`;band.append(tag);
    const cells=document.createElement('div');cells.className='unit-run-cells';
    for(const u of shown.slice(i,j)){
      const cell=document.createElement('span');
      cell.className=`unit-cell ${u.stable?'stable':'variable'}${kind==='Binary'?' binary':''}${['ASCII','Plain Text'].includes(kind)?' text-unit':''}${kind==='Binary'&&(u.index+1)%8===0?' byte-boundary':''}`;
      cell.textContent=u.display===' '? '␣' : u.display;
      const detail=u.variants.slice(0,10).map(v=>v===' '?'[space]':v).join(', ');
      cell.title=`${view.singular[0].toUpperCase()+view.singular.slice(1)} ${u.index} · ${stable?'unchanged':'changing'} · ${detail}${u.partial?' (partial byte)':''}`;
      cells.append(cell);
    }
    band.append(cells);frag.append(band);i=j;
  }
  ui.track.append(frag);
  if(err)ui.track.textContent='—';
  ui.track.setAttribute('aria-label',err?`Analysis error: ${err}`:`${view.stable} unchanged and ${view.variable} changing ${view.plural}`);
  ui.track.title=view.units.length>displayLimit?`Showing the first ${displayLimit} ${view.plural} of ${view.units.length}`:'';
  $('insightNote').textContent=err?err:view.valid<2?'Paste two or more packets to compare their positions.':
    `${view.compared} ${view.plural} compared across ${view.valid} packets. Teal stays the same; copper changes.${view.units.length>displayLimit?' Only the first '+displayLimit+' are shown.':''}`;
  const res=document.createDocumentFragment();
  mergeFieldRuns(detailed.fields).slice(0,12).forEach(f=>{
    const el=document.createElement('div');el.className='field-result';
    const left=document.createElement('span');left.className='field-pos';
    if(kind==='Hex'){
      const a=Math.floor(f.start/8),b=Math.floor((f.end-1)/8);
      left.textContent=`${a===b?'Byte '+a:'Bytes '+a+'–'+b} · bits ${f.start}–${f.end-1} (${f.width}b)`;
    }else left.textContent=`Bits ${f.start}–${f.end-1} · ${f.width}b`;
    const right=document.createElement('span');right.className=`field-kind ${f.kind==='VARIABLE'?'variable':''}`;right.textContent=f.kind==='STABLE'?'SAME':'DIFFERENT';
    el.title=`${f.width} consecutive ${f.kind==='STABLE'?'unchanged':'changing'} bits${f.segments>1?` · combined from ${f.segments} detected runs`: ''}`;
    el.append(left,right);res.append(el);
  });ui.results.append(res);
}

// Native text selection is displayed for editing and copying text. A pointer
// drag within one row instead draws a Nibbler field; Shift+drag is native text.
function syncNativeSelection(){
  if(skipSelection||selectionLocked||drag||reorder||pointerSelect||nativeSelectMode)return;
  const start=ui.input.selectionStart,end=ui.input.selectionEnd;
  if(start===end){lastSelectionKey='';return;}
  const text=ui.input.value,all=rows();
  const lineA=text.slice(0,start).split('\n').length-1;
  const lineB=text.slice(0,end).split('\n').length-1;
  const colA=start-indexFor(lineA,0,all);
  const colB=end-indexFor(lineB,0,all);
  // Multi-row text is an ordinary editable selection, not a protocol field.
  if(lineA!==lineB){if(candidate){candidate=null;editingId=null;scheduleRender();}lastSelectionKey='';return;}
  const backward=ui.input.selectionDirection==='backward';
  const line=(backward?lineB:lineA);
  const {positions}=lineSymbols(all[line]??'',format());
  const boundA=backward?(lineA===lineB?colB:colB):colA;
  const boundB=lineA===lineB?(backward?colA:colB):(backward?0:all[line].length);
  const [a,b]=rawRangeToSymbols(positions,Math.min(boundA,boundB),Math.max(boundA,boundB));
  if(a===b)return;
  const key=`${line}:${a}:${b}:${format()}:${editingId}`;
  if(key===lastSelectionKey)return;lastSelectionKey=key;
  newCandidate(line,a,b,editingId!==null?(groupFor(editingId)?.mode??matchMode):matchMode);
}
function newCandidate(line,start,end,mode=matchMode){
  candidate={line,edgeA:start,edgeB:end,mode,
    get start(){return Math.min(this.edgeA,this.edgeB);},get end(){return Math.max(this.edgeA,this.edgeB);},get width(){return Math.abs(this.edgeA-this.edgeB);}};
  lastSelectionKey='';scheduleRender();
}
function clearNativeSelection(){
  selectionLocked=true;nativeSelectMode=false;skipSelection=true;
  const pos=ui.input.selectionEnd;
  ui.input.setSelectionRange(pos,pos);
  skipSelection=false;lastSelectionKey='';
  // Context-menu buttons may restore the textarea's old selection on blur.
  // Suppress those stale select events and collapse again on the next frame.
  requestAnimationFrame(()=>{if(selectionLocked){const end=ui.input.selectionEnd;skipSelection=true;ui.input.setSelectionRange(end,end);skipSelection=false;}});
}
function cancelSelection(){
  if(reorder){stopReorder(true);return;}
  if(drag){drag=null;document.body.style.cursor='';}
  if(!candidate)return;
  candidate=null;editingId=null;clearNativeSelection();scheduleRender();toast('Selection cancelled');
}
function saveCandidate(){
  if(!candidate)return;
  const needle=selectedNeedle();
  if(editingId!==null){
    const g=groupFor(editingId);
    if(g){
      if(!candidate.width||!needle){groups=groups.filter(x=>x.id!==editingId);toast(`${g.label} removed — selection has zero width`);}
      else{g.needle=needle;g.offset=candidate.start;g.mode=candidate.mode;toast(`${g.label} updated · ${candidate.width} symbols`);}
    }
  } else if(needle){
    const [color,accent]=PALETTE[(nextId-1)%PALETTE.length];
    const g={id:nextId,label:`G${nextId}`,color,accent,needle,offset:candidate.start,mode:candidate.mode,encoding:format()};
    groups.push(g);nextId++;toast(`${g.label} saved — select another field to continue`);
  }else {toast('Select at least one symbol before saving');return;}
  candidate=null;editingId=null;clearNativeSelection();refresh();
}
function beginEdit(id,hit=null){
  const g=groupFor(id);if(!g)return;
  if(g.encoding!==format()){ui.format.value=g.encoding;toast(`Switched to ${g.encoding} to edit ${g.label}`);}
  const hits=findMatches(rows(),g.encoding,g.needle,g.offset,g.mode);
  const m=hit??hits[0];if(!m){toast(`${g.label} no longer matches the text. Delete it from the group menu if needed.`);return;}
  editingId=id;newCandidate(m.line,m.symbolStart,m.symbolEnd,g.mode);clearNativeSelection();
  ui.input.focus({preventScroll:true});toast(`Editing ${g.label} — drag any highlighted edge or centre`);
}
function deleteGroup(id){
  const g=groupFor(id);if(!g)return;
  groups=groups.filter(x=>x.id!==id);
  if(editingId===id){editingId=null;candidate=null;clearNativeSelection();}
  refresh();toast(`${g.label} deleted`);
}
function getNearestSymbolAtX(clientX,line){
  const rect=ui.box.getBoundingClientRect(),raw=(clientX-rect.left+ui.input.scrollLeft-padLeft)/charWidth;
  const {positions}=lineSymbols(rows()[line]??'',format());
  return nearestSymbolBoundary(positions,raw);
}
function pointerLine(e){
  const rect=ui.box.getBoundingClientRect();
  return clamp(Math.floor((e.clientY-rect.top+ui.input.scrollTop-padTop)/rowH),0,rows().length-1);
}
// Drag inside a row to create a field. Cross rows to select editable text;
// Shift+drag provides ordinary text selection even within one row.
function beginCanvasSelection(e){
  if(e.button!==0||reorder||drag)return;
  if(e.detail>=2||e.shiftKey||e.altKey||e.ctrlKey||e.metaKey){
    // Native mouse selection: supports arbitrary text spans and editing.
    candidate=null;editingId=null;selectionLocked=false;nativeSelectMode=true;
    scheduleRender();return;
  }
  e.preventDefault();hideMenu();
  const line=pointerLine(e), ls=rows();
  if(!ls[line] || !lineSymbols(ls[line],format()).positions.length){
    candidate=null;editingId=null;scheduleRender();return;
  }
  const anchor=getNearestSymbolAtX(e.clientX,line);
  // Exact caret position for text editing, separate from the nibble boundary.
  const rect=ui.box.getBoundingClientRect();
  const col=clamp(Math.round((e.clientX-rect.left+ui.input.scrollLeft-padLeft)/charWidth),0,ls[line].length);
  skipSelection=true;ui.input.focus({preventScroll:true});
  const pos=indexFor(line,col);ui.input.setSelectionRange(pos,pos);skipSelection=false;
  selectionLocked=true;lastSelectionKey='';
  nativeSelectMode=false;
  pointerSelect={line,anchor,anchorIndex:pos,downX:e.clientX,downY:e.clientY,started:false,native:false};
  try{ui.input.setPointerCapture(e.pointerId);}catch{}
}
function updateCanvasSelection(e){
  if(!pointerSelect)return;
  const p=pointerSelect,currentLine=pointerLine(e);
  if(currentLine!==p.line&&!p.native){
    p.native=true;p.started=true;candidate=null;editingId=null;
    selectionLocked=false;nativeSelectMode=true;lastSelectionKey='';scheduleRender();
  }
  if(p.native){
    const ls=rows(),rect=ui.box.getBoundingClientRect();
    const col=clamp(Math.round((e.clientX-rect.left+ui.input.scrollLeft-padLeft)/charWidth),0,ls[currentLine].length);
    const end=indexFor(currentLine,col,ls),a=p.anchorIndex;
    skipSelection=true;
    ui.input.setSelectionRange(Math.min(a,end),Math.max(a,end),end<a?'backward':'forward');
    skipSelection=false;return;
  }
  const b=getNearestSymbolAtX(e.clientX,p.line);
  if(!p.started){
    if(Math.abs(e.clientX-p.downX)<3 && Math.abs(e.clientY-p.downY)<3)return;
    p.started=true;editingId=null;newCandidate(p.line,p.anchor,b);
  }
  if(candidate && candidate.edgeB!==b){candidate.edgeB=b;lastSnap=performance.now();scheduleRender();}
}
function endCanvasSelection(e){
  if(!pointerSelect)return;
  const p=pointerSelect;updateCanvasSelection(e);
  if(!p.native){
    if(p.started && candidate && !candidate.width){candidate=null;editingId=null;scheduleRender();}
    else if(!p.started){candidate=null;editingId=null;scheduleRender();}
  }
  pointerSelect=null;
  try{ui.input.releasePointerCapture(e.pointerId);}catch{}
}
function fieldPointerDown(e){
  const element=e.target.closest('.field');if(!element||e.button!==0)return;
  e.preventDefault();e.stopPropagation();hideMenu();
  const line=Number(element.dataset.line),start=Number(element.dataset.start),end=Number(element.dataset.end);
  if(element.dataset.type==='saved'){
    const group=groupFor(Number(element.dataset.group));if(!group)return;
    editingId=group.id;newCandidate(line,start,end,group.mode);
  } else if(!candidate)return;
  ui.input.focus({preventScroll:true});clearNativeSelection();
  candidate.line=line;candidate.edgeA=start;candidate.edgeB=end;
  const side=e.target.closest('.field-grip')?.dataset.side;
  drag={type:side?'resize':'move',side,line,start,end,width:end-start,startX:e.clientX,
    fixed:side==='left'?end:start};
  element.classList.add('dragging');
  document.body.style.cursor=side?'ew-resize':'grabbing';
  scheduleRender();
}
function fieldPointerMove(e){
  if(!drag||!candidate)return;
  const c=candidate;
  if(drag.type==='move'){
    const nextLine=pointerLine(e);
    const nextMax=lineSymbols(rows()[nextLine]??'',format()).value.length;
    if(nextMax<drag.width)return;
    const delta=Math.round((e.clientX-drag.startX)/charWidth);
    const next=clamp(drag.start+delta,0,nextMax-drag.width);
    if(next===c.start&&c.line===nextLine)return;
    c.line=nextLine;c.edgeA=next;c.edgeB=next+drag.width;
  }else{
    // Resizing stays on the original row; dragging a handle across rows does not
    // change which packet owns the selection.
    const max=lineSymbols(rows()[drag.line]??'',format()).value.length;
    const next=clamp(getNearestSymbolAtX(e.clientX,drag.line),0,max);
    if(next===c.edgeB)return;
    c.line=drag.line;c.edgeA=drag.fixed;c.edgeB=next;
  }
  lastSnap=performance.now();scheduleRender();
}
function fieldPointerUp(){
  if(!drag)return;drag=null;document.body.style.cursor='';scheduleRender();
}

function showMenu(e,items,title){
  ui.context.replaceChildren();
  const header=document.createElement('div');header.className='context-header';header.textContent=title;ui.context.append(header);
  items.forEach(item=>{
    if(item.separator){const sep=document.createElement('div');sep.className='context-sep';ui.context.append(sep);return;}
    if(item.header){const row=document.createElement('div');row.className='context-convert';row.textContent=item.header;ui.context.append(row);return;}
    const b=document.createElement('button');b.className=`context-row${item.danger?' danger':''}`;
    const name=document.createElement('span');name.textContent=item.text;b.append(name);
    if(item.key){const k=document.createElement('span');k.className='key';k.textContent=item.key;b.append(k);}
    b.addEventListener('click',()=>{hideMenu();item.action();});ui.context.append(b);
  });
  ui.context.hidden=false;let x=e.clientX,y=e.clientY;
  const w=ui.context.offsetWidth,h=ui.context.offsetHeight;
  x=clamp(x,8,window.innerWidth-w-8);y=clamp(y,8,window.innerHeight-h-8);
  ui.context.style.left=`${x}px`;ui.context.style.top=`${y}px`;
}
function hideMenu(){ui.context.hidden=true;}
function conversionOptions(source){
  return [{separator:true},{header:'CONVERT FIELD TO…'},
    ...['Hex','Binary','Decimal'].map(dest=>({text:dest,key:'↗',action:()=>openConversion(source,dest)}))];
}
function fieldMenu(e,el){
  if(!el)return;
  e.preventDefault();hideMenu();
  if(el.dataset.type==='draft'){
    const value=selectedNeedle();
    showMenu(e,[
      {text:editingId!==null?'Save changes':'Save as group',key:'↵',action:saveCandidate},
      {text:editingId!==null?'Cancel edit':'Discard selection',key:'Esc',action:cancelSelection},
      ...conversionOptions({value,encoding:format()})
    ],editingId!==null?`EDIT ${groupFor(editingId)?.label??''}`:'UNSAVED FIELD');
  }else groupMenu(e,Number(el.dataset.group));
}
function groupMenu(e,id){
  const g=groupFor(id);if(!g)return;
  showMenu(e,[
    {text:'Edit group',key:'↗',action:()=>beginEdit(id)},
    {text:'Delete group',key:'⌫',danger:true,action:()=>deleteGroup(id)},
    ...conversionOptions({value:g.needle,encoding:g.encoding})
  ],`${g.label} · SAVED GROUP`);
}
function openConversion(source,destination){
  try{
    convText=convertField(source.value,source.encoding,destination);
    $('convertTitle').textContent=`As ${destination.toLowerCase()}`;
    ui.conversion.textContent=convText;ui.dialog.hidden=false;$('copyConvert').focus();
  }catch(err){toast(err.message);}
}
// Reformat every editor packet. The change is atomic: malformed input never
// partly updates the canvas. Exact Hex↔Binary group positions migrate as well.
function convertCanvas(target){
  const from=format();
  if(from===target){hideMenu();toast(`Packets are already ${target}`);return;}
  const before=rows();
  let converted;
  try{converted=convertPackets(before,from,target);}catch(err){toast(err.message);return;}
  const remapped=groups.map(group=>{
    if(group.encoding!==from)return {...group};
    if(from==='Hex'&&target==='Binary'){
      return {...group,encoding:'Binary',needle:[...group.needle].map(c=>parseInt(c,16).toString(2).padStart(4,'0')).join(''),offset:group.offset*4};
    }
    if(from==='Binary'&&target==='Hex'&&group.offset%4===0&&group.needle.length%4===0&&before.every(l=>!l.trim()||toBits(l,'Binary').length%4===0)){
      return {...group,encoding:'Hex',needle:group.needle.match(/.{4}/g).map(b=>parseInt(b,2).toString(16).toUpperCase()).join(''),offset:group.offset/4};
    }
    return {...group}; // Unsupported field mapping is retained in its original encoding.
  });
  const hidden=remapped.filter(g=>g.encoding!==target);
  if(hidden.length){
    const ok=confirm(`${hidden.length} saved group(s) cannot be represented as exact ${target} field boundaries. They will remain saved in their original format, but be hidden while viewing ${target}. Continue?`);
    if(!ok)return;
  }
  // Warn about leading-zero precision loss when converting to numbers.
  if(target==='Decimal'&&from!=='Decimal'&&before.some(l=>/^\s*(?:0x|0b)?0[0-9a-f]/i.test(l))){
    if(!confirm('Decimal displays numeric values and cannot preserve leading-zero padding. Continue?'))return;
  }
  ui.input.value=converted.join('\n');
  ui.format.value=target;ui.delimiter.value='';
  groups=remapped;candidate=null;editingId=null;selectionLocked=false;
  clearNativeSelection();ui.input.scrollLeft=0;refresh();
  toast(`Converted ${before.filter(l=>l.trim()).length} packets to ${target}${hidden.length?' · '+hidden.length+' groups retained in their original format':''}`);
}
function deleteTextSelection(){
  const start=ui.input.selectionStart,end=ui.input.selectionEnd;if(start===end)return;
  ui.input.focus({preventScroll:true});ui.input.setRangeText('',start,end,'start');
  candidate=null;editingId=null;selectionLocked=false;nativeSelectMode=false;refresh();
}
async function copyTextSelection(cut=false){
  const start=ui.input.selectionStart,end=ui.input.selectionEnd;
  if(start===end)return;
  const value=ui.input.value.slice(start,end);
  try{await navigator.clipboard.writeText(value);if(cut)deleteTextSelection();else toast('Selected text copied');}
  catch{ui.input.focus();ui.input.setSelectionRange(start,end);document.execCommand(cut?'cut':'copy');refresh();}
}
function globalTools(e){
  e.preventDefault();hideMenu();
  const hasText=ui.input.selectionEnd>ui.input.selectionStart;
  showMenu(e,[
    ...(hasText?[{header:'TEXT SELECTION'},
      {text:'Copy selected text',key:'Ctrl+C',action:()=>copyTextSelection()},
      {text:'Cut selected text',key:'Ctrl+X',action:()=>copyTextSelection(true)},
      {text:'Delete selected text',key:'Del',action:deleteTextSelection},
      {separator:true}]:[]),
    {header:'CONVERT ALL PACKETS TO…'},
    ...['Hex','Binary','Decimal'].map(dest=>({text:dest,key:dest===format()?'Current':'Convert',action:()=>convertCanvas(dest)})),
    {separator:true},
    {text:'Select all packet text',key:'Ctrl+A',action:()=>{ui.input.focus();ui.input.select();}},
  ],'GLOBAL TOOLS');
}
function normalizeCanvasInput(){
  const parts=splitPackets(ui.input.value,ui.delimiter.value);
  const result=parts.join('\n');
  if(result===ui.input.value)return;
  ui.input.value=result;ui.input.scrollTop=0;
  candidate=null;editingId=null;clearNativeSelection();refresh();
  toast(`Separated ${parts.length} packet${parts.length===1?'':'s'} into rows`);
}
function downloadFile(name,content,type){
  const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),8000);
}
function saveProject(){
  const content={version:1,text:ui.input.value,format:format(),delimiter:ui.delimiter.value,match_mode:matchMode,
    min_field_width:clamp(Number(ui.min.value)||2,1,128),variable_mode:ui.variable.value,
    groups:groups.map(g=>({...g})),next_group_id:nextId};
  downloadFile(currentFileName,JSON.stringify(content,null,2),'application/json');
  toast('Project downloaded · saved groups and packet text included');
}
async function openProject(file){
  if(!file)return;
  try{
    if(file.size>8e6)throw new Error('Project too large (>8 MB)');
    const state=validateProject(JSON.parse(await file.text()));
    ui.input.value=state.text;ui.format.value=state.format;matchMode=state.matchMode;
    ui.min.value=state.minimum;ui.variable.value=state.variableMode;ui.delimiter.value=state.delimiter;
    groups=state.groups;nextId=state.nextId;editingId=null;candidate=null;
    currentFileName=file.name.endsWith('.json')?file.name:'nibbler-project.nibbler.json';
    clearNativeSelection();updateSegments();refresh();ui.input.focus({preventScroll:true});toast(`Opened ${file.name}`);
  }catch(err){toast(`Could not open project: ${err.message}`);}
}
function updateSegments(){
  document.querySelectorAll('.segment').forEach(btn=>{const active=btn.dataset.mode===matchMode;btn.classList.toggle('active',active);btn.setAttribute('aria-pressed',String(active));});
}

// Row reordering: the gap, gutter insertion line and final text position all
// use the same *target index*. Other rows slide into place while dragging.
function beginReorder(e){
  if(e.button!==0||reorder)return;
  const ls=rows(),rect=ui.box.getBoundingClientRect();
  const line=Math.floor((e.clientY-rect.top+ui.input.scrollTop-padTop)/rowH);
  if(line<0||line>=ls.length)return;
  e.preventDefault();hideMenu();
  const all=ls.map((text,id)=>({text,id}));
  const item=all[line],others=all.filter(x=>x.id!==item.id);
  const slotCenter=rect.top+padTop+line*rowH-ui.input.scrollTop+rowH/2;
  reorder={original:line,item,others,target:line,mouseY:e.clientY,grabOffset:e.clientY-slotCenter,
    nodes:new Map(),gutterNodes:new Map(),dropTimer:null};
  pointerSelect=null;ui.input.classList.add('is-reordering');ui.layer.replaceChildren();
  ui.reorderLayer.hidden=false;ui.reorderLayer.replaceChildren();
  const slot=document.createElement('div');slot.className='reorder-slot';reorder.slot=slot;ui.reorderLayer.append(slot);
  for(const x of others){
    const node=document.createElement('div');node.className='reorder-row';node.textContent=x.text;node.style.left=`${padLeft-ui.input.scrollLeft}px`;
    reorder.nodes.set(x.id,node);ui.reorderLayer.append(node);
  }
  const chip=document.createElement('div');chip.className='drag-chip';chip.textContent=item.text||'(empty line)';
  ui.reorderLayer.append(chip);reorder.chip=chip;
  ui.dropLine.hidden=false;
  createReorderGutter();positionReorder();
  requestAnimationFrame(()=>chip.classList.add('picked'));
}
function createReorderGutter(){
  const frag=document.createDocumentFragment();
  for(const x of reorder.others){const node=makeGutterRow(x.id,0,String(x.id));reorder.gutterNodes.set(x.id,node);frag.append(node);}
  ui.gutterItems.replaceChildren(frag);
}
function positionReorder(){
  if(!reorder)return;
  const r=reorder,order=[...r.others];order.splice(r.target,0,r.item);
  const slotTop=padTop+r.target*rowH-ui.input.scrollTop;
  r.slot.style.top=`${slotTop+2}px`;
  ui.dropLine.style.top=`${slotTop}px`;
  order.forEach((x,position)=>{
    if(x.id===r.item.id)return;
    const top=padTop+position*rowH-ui.input.scrollTop;
    const node=r.nodes.get(x.id);node.style.top=`${top}px`;
    const grip=r.gutterNodes.get(x.id);grip.style.top=`${top}px`;
    grip.querySelector('.gutter-num').textContent=String(position+1).padStart(2,'0');
  });
  const center=r.mouseY-r.grabOffset-ui.box.getBoundingClientRect().top;
  r.chip.style.top=`${center-(rowH-2)/2}px`;
}
function updateReorder(e){
  if(!reorder)return;
  const r=reorder,rect=ui.box.getBoundingClientRect();
  r.mouseY=e.clientY;
  const cy=e.clientY-r.grabOffset;
  const target=clamp(Math.round((cy-rect.top+ui.input.scrollTop-padTop-rowH/2)/rowH),0,r.others.length);
  if(target!==r.target)r.target=target;
  positionReorder();
  // Auto-scroll when holding close to the top/bottom edge.
  const relative=e.clientY-rect.top;
  if(relative<19)ui.input.scrollTop=Math.max(0,ui.input.scrollTop-8);
  else if(relative>rect.height-19)ui.input.scrollTop+=8;
}
function stopReorder(cancel=false){
  if(!reorder)return;
  const r=reorder;
  if(cancel){cleanupReorder();toast('Reorder cancelled');return;}
  const newOrder=[...r.others];newOrder.splice(r.target,0,r.item);
  const cy=padTop+r.target*rowH-ui.input.scrollTop+1;
  r.chip.classList.remove('picked');r.chip.classList.add('settling');r.chip.style.top=`${cy}px`;
  r.dropTimer=setTimeout(()=>{
    if(reorder!==r)return;
    if(r.target!==r.original){
      // Keep any active field anchored to the same *packet*, even after moving.
      if(candidate){
        const previousId=candidate.line;
        const remapped=newOrder.findIndex(x=>x.id===previousId);
        if(remapped>=0)candidate.line=remapped;
      }
      const scroll=ui.input.scrollTop;
      ui.input.value=newOrder.map(x=>x.text).join('\n');ui.input.scrollTop=scroll;
      const caret=indexFor(r.target,0,newOrder.map(x=>x.text));
      skipSelection=true;ui.input.setSelectionRange(caret,caret);skipSelection=false;
    }
    cleanupReorder();refresh();
    if(r.target!==r.original)toast(`Moved row ${r.original+1} → ${r.target+1}`);
  },65); // a short commit delay; pointer movement itself is immediate
}
function cleanupReorder(){
  if(!reorder)return;clearTimeout(reorder.dropTimer);reorder=null;
  ui.input.classList.remove('is-reordering');ui.reorderLayer.hidden=true;
  ui.reorderLayer.replaceChildren();ui.dropLine.hidden=true;
  ui.input.focus({preventScroll:true});scheduleRender();
}
function keyboardReorder(direction){
  const pos=ui.input.selectionStart,ls=rows(),line=ui.input.value.slice(0,pos).split('\n').length-1;
  const to=line+direction;if(to<0||to>=ls.length)return;
  [ls[line],ls[to]]=[ls[to],ls[line]];ui.input.value=ls.join('\n');
  if(candidate){if(candidate.line===line)candidate.line=to;else if(candidate.line===to)candidate.line=line;}
  const col=Math.min(pos-indexFor(line,0),ls[to].length);
  ui.input.setSelectionRange(indexFor(to,col),indexFor(to,col));
  refresh();toast(`Row ${line+1} moved to ${to+1}`);
}

// Events
ui.input.addEventListener('pointerdown',beginCanvasSelection);
ui.input.addEventListener('pointermove',updateCanvasSelection);
ui.input.addEventListener('pointerup',endCanvasSelection);
ui.input.addEventListener('pointercancel',endCanvasSelection);
ui.input.addEventListener('select',()=>requestAnimationFrame(syncNativeSelection));
ui.input.addEventListener('keydown',e=>{if(e.shiftKey&&(['Home','End','PageUp','PageDown'].includes(e.key)||e.key.startsWith('Arrow')))selectionLocked=false;});
ui.input.addEventListener('keyup',e=>{if(e.shiftKey||e.key.startsWith('Arrow'))syncNativeSelection();});
ui.input.addEventListener('pointerup',()=>{if(nativeSelectMode&&!pointerSelect)requestAnimationFrame(()=>{nativeSelectMode=false;});});
ui.input.addEventListener('input',()=>{if(!drag){candidate=null;editingId=null;lastSelectionKey='';nativeSelectMode=false;}refresh();});
ui.input.addEventListener('paste',e=>{
  const pasted=e.clipboardData?.getData('text/plain');
  if(pasted===undefined)return;
  const split=splitPackets(pasted,ui.delimiter.value);
  // Only intercept when the clipboard includes the selected delimiter or linebreak.
  const mark=packetDelimiter(ui.delimiter.value);
  if(!pasted.includes(mark)&&!/[\r\n]/.test(pasted))return;
  e.preventDefault();
  const normalized=split.join('\n');
  ui.input.setRangeText(normalized,ui.input.selectionStart,ui.input.selectionEnd,'end');
  candidate=null;editingId=null;clearNativeSelection();refresh();
  if(split.length>1)toast(`Imported ${split.length} packets`);
});
ui.delimiter.addEventListener('change',normalizeCanvasInput);
ui.delimiter.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();normalizeCanvasInput();ui.input.focus();}});

ui.input.addEventListener('scroll',()=>{if(reorder)positionReorder();else scheduleRender();drawRuler();});
ui.input.addEventListener('contextmenu',globalTools);
ui.box.addEventListener('contextmenu',e=>{if(!e.defaultPrevented)globalTools(e);});
ui.layer.addEventListener('pointerdown',fieldPointerDown);
ui.layer.addEventListener('contextmenu',e=>fieldMenu(e,e.target.closest('.field')));
ui.gutter.addEventListener('pointerdown',beginReorder);
window.addEventListener('pointermove',e=>{if(reorder)updateReorder(e);else if(drag)fieldPointerMove(e);});
window.addEventListener('pointerup',e=>{if(reorder)stopReorder();else fieldPointerUp(e);});
window.addEventListener('blur',()=>{ui.stage.classList.remove('native-select-mode');if(drag)fieldPointerUp();if(reorder)stopReorder(true);});
ui.gutter.addEventListener('wheel',e=>{ui.input.scrollTop+=e.deltaY;e.preventDefault();},{passive:false});
ui.format.addEventListener('change',()=>{candidate=null;editingId=null;clearNativeSelection();refresh();});
ui.min.addEventListener('change',scheduleAnalysis);
ui.variable.addEventListener('change',scheduleAnalysis);
document.querySelectorAll('.segment').forEach(b=>b.addEventListener('click',()=>{matchMode=b.dataset.mode;updateSegments();if(candidate&&editingId===null){candidate.mode=matchMode;scheduleRender();}}));
$('loadDemo').addEventListener('click',()=>{
  if(ui.input.value.trim()&&!confirm('Replace the current packets with synthetic example frames? Saved groups will also be cleared.'))return;
  groups=[];nextId=1;candidate=null;editingId=null;ui.format.value='Hex';ui.delimiter.value='';ui.input.value=DEMO;
  ui.input.focus({preventScroll:true});ui.input.setSelectionRange(0,0);
  ui.input.scrollTop=0;ui.input.scrollLeft=0;refresh();toast('Loaded synthetic protocol frames · compare headers, commands and trailers');
});
$('saveBtn').addEventListener('click',saveProject);$('openBtn').addEventListener('click',()=>ui.fileInput.click());
ui.fileInput.addEventListener('change',()=>{openProject(ui.fileInput.files?.[0]);ui.fileInput.value='';});
$('closeConvert').addEventListener('click',()=>ui.dialog.hidden=true);
$('copyConvert').addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText(convText);ui.dialog.hidden=true;toast('Converted value copied');}
  catch{toast('Clipboard unavailable. Select the value and copy it manually.');}
});
ui.dialog.addEventListener('click',e=>{if(e.target===ui.dialog)ui.dialog.hidden=true;});
document.addEventListener('pointerdown',e=>{if(!ui.context.hidden&&!ui.context.contains(e.target))hideMenu();});
window.addEventListener('scroll',hideMenu,true);
window.addEventListener('resize',()=>{metrics();scheduleRender();if(reorder)positionReorder();});
document.addEventListener('keydown',e=>{
  if(e.key==='Shift')ui.stage.classList.add('native-select-mode');
  if(e.key==='Escape'){
    if(!ui.dialog.hidden){ui.dialog.hidden=true;return;}
    if(!ui.context.hidden){hideMenu(); /* Esc also cancels the active draft. */ }
    if(reorder){e.preventDefault();stopReorder(true);return;}
    if(pointerSelect){pointerSelect=null;try{ui.input.releasePointerCapture(e.pointerId);}catch{}}
    e.preventDefault();cancelSelection();return;
  }
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a'&&document.activeElement===ui.input){
    // Ctrl+A is an actual editable textarea selection, not a packet field.
    candidate=null;editingId=null;selectionLocked=false;nativeSelectMode=true;scheduleRender();return;
  }
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();saveProject();return;}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='o'){e.preventDefault();ui.fileInput.click();return;}
  if(e.altKey&&['ArrowUp','ArrowDown'].includes(e.key)&&document.activeElement===ui.input){e.preventDefault();keyboardReorder(e.key==='ArrowUp'?-1:1);}
});
document.addEventListener('keyup',e=>{if(e.key==='Shift')ui.stage.classList.remove('native-select-mode');});
// Escape works after a group has been saved; for newly selected text, it clears
// the draft only, without mutating the saved model.
window.__nibblerTest={
  getState:()=>({candidate:candidate?{line:candidate.line,start:candidate.start,end:candidate.end,mode:candidate.mode}:null,groups:structuredClone(groups),text:ui.input.value,previewCount:previewHits.length,matchMode}),
  setCandidate:(line,start,end)=>newCandidate(line,start,end),saveCandidate,beginEdit,cancelSelection,beginReorder,stopReorder,
  setText:text=>{ui.input.value=text;candidate=null;editingId=null;refresh();},
  setDelimiter:d=>{ui.delimiter.value=d;normalizeCanvasInput();},convertCanvas,
  setFormat:f=>{ui.format.value=f;refresh();},setTheme,refresh,rows
};
$('copyrightYear').textContent=String(new Date().getFullYear());
$('themeSelect').addEventListener('change',e=>setTheme(e.target.value));
let initialTheme='modern';try{initialTheme=localStorage.getItem('nibbler-theme')||'modern';}catch{}
setTheme(initialTheme);metrics();updateSegments();refresh();
