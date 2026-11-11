/* Nibbler by Breachbyte — pure protocol analysis. No runtime dependencies. */
export const FORMATS = ['Hex', 'Binary', 'ASCII', 'Plain Text', 'Decimal'];
export const MATCH_MODES = ['Aligned', 'Anywhere'];
export const VARIABLE_MODES = ['Split by change pattern', 'Merge adjacent changing bits'];

// Deep mineral tones with light edge highlights. Avoid pastel-first UI chrome.
export const PALETTE = [
  ['#286E67', '#B0E9D6'], ['#9D643B', '#FFD0A3'],
  ['#375D81', '#ACD8F2'], ['#777F43', '#E3E8A1'],
  ['#975851', '#F9BAA8'], ['#526E68', '#C5DDD1'],
  ['#916A40', '#EBD49B'], ['#3E7690', '#ADE2EF'],
  ['#885C73', '#F1BED4'], ['#567343', '#CFE6B2'],
  ['#9A6D4B', '#F5C4AD'], ['#46778A', '#C5E7E9']
];

export function lineSymbols(line, mode) {
  const positions = [];
  if (mode === 'ASCII' || mode === 'Plain Text') {
    for (let i=0;i<line.length;i++) positions.push(i);
    return { value: line, positions };
  }
  if (mode === 'Decimal') {
    for (let i=0;i<line.length;i++) if (/[0-9]/.test(line[i])) positions.push(i);
    return { value: positions.map(i => line[i]).join(''), positions };
  }
  const alphabet = mode === 'Binary' ? /[01]/ : /[0-9a-f]/i;
  const all = mode === 'Binary' ? /^[01_\s]+$/ : /^[0-9a-f_\s]+$/i;
  const prefix = mode === 'Binary' ? /0b([01_\s]+)/i : /0x([0-9a-f_\s]+)/i;
  const explicit = prefix.exec(line);
  let first=0,last=line.length;
  if (explicit) {
    first=explicit.index+2; last=first+explicit[1].length;
  } else if (!all.test(line) || !line.trim()) {
    // Match the longest data-like sequence on a captured/log-labelled line.
    const pattern=mode === 'Binary' ? /[01][01_\s]*/g : /[0-9a-f][0-9a-f_\s]*/gi;
    let best=null, match;
    while ((match=pattern.exec(line))) {
      const n=[...match[0]].filter(c=>alphabet.test(c)).length;
      if (!best || n>best.n) best={start:match.index,end:match.index+match[0].length,n};
    }
    if (!best) return {value:'',positions:[]};
    first=best.start;last=best.end;
  }
  for(let i=first;i<last;i++) if (alphabet.test(line[i])) positions.push(i);
  let value=positions.map(i=>line[i]).join('');
  if (mode==='Hex') value=value.toUpperCase();
  return {value,positions};
}

export function symbolBoundaryRaw(positions, boundary) {
  if (!positions.length) return 0;
  if (boundary<=0) return positions[0];
  if (boundary>=positions.length) return positions.at(-1)+1;
  return positions[boundary];
}

export function rawRangeToSymbols(positions, left, right) {
  return [positions.filter(p=>p<left).length, positions.filter(p=>p<right).length];
}

export function nearestSymbolBoundary(positions, rawCharPosition) {
  if (!positions.length) return 0;
  let best=0,delta=Infinity;
  for(let i=0;i<=positions.length;i++) {
    const x=symbolBoundaryRaw(positions,i);
    if(Math.abs(x-rawCharPosition)<=delta) {best=i;delta=Math.abs(x-rawCharPosition);}
  }
  return best;
}

export function findMatches(lines, format, needle, offset, mode) {
  if (!needle) return [];
  const out=[];
  lines.forEach((line,lineIndex)=>{
    const {value,positions}=lineSymbols(line,format);
    let starts=[];
    if (mode==='Aligned') {
      if(value.slice(offset,offset+needle.length)===needle) starts=[offset];
    } else {
      let at=0;
      while(at<=value.length-needle.length) {
        const hit=value.indexOf(needle,at);
        if(hit<0) break;
        starts.push(hit);at=hit+Math.max(1,needle.length);
      }
    }
    for(const s of starts) {
      const e=s+needle.length;
      if(s<positions.length && e<=positions.length)
        out.push({line:lineIndex,rawStart:positions[s],rawEnd:positions[e-1]+1,symbolStart:s,symbolEnd:e});
    }
  });
  return out;
}

export function toBits(value,format) {
  let s=value.replace(/[\s_]+/g,'');
  if(format==='Hex') {
    s=s.replace(/^0x/i,'');
    if(!/^[0-9a-f]+$/i.test(s)) throw new Error(`Invalid hex packet: ${value.slice(0,35)}`);
    return [...s].map(c=>parseInt(c,16).toString(2).padStart(4,'0')).join('');
  }
  if(format==='Binary') {
    s=s.replace(/^0b/i,'');
    if(!/^[01]+$/.test(s)) throw new Error(`Invalid binary packet: ${value.slice(0,35)}`);
    return s;
  }
  if(format==='Decimal') {
    if(!/^[0-9]+$/.test(s)) throw new Error(`Invalid decimal packet: ${value.slice(0,35)}`);
    const b=BigInt(s).toString(2);return b.padStart(Math.max(8,Math.ceil(b.length/8)*8),'0');
  }
  if(format==='ASCII' && /[^\x00-\x7f]/.test(value)) throw new Error('Non-ASCII character in ASCII mode');
  return Array.from(new TextEncoder().encode(value),b=>b.toString(2).padStart(8,'0')).join('');
}

export function convertField(value,from,to) {
  const bits=toBits(value,from);
  if(to==='Binary')return bits;
  if(to==='Decimal')return BigInt('0b'+bits).toString(10);
  if(to==='Hex')return '0x'+BigInt('0b'+bits).toString(16).toUpperCase().padStart(Math.ceil(bits.length/4),'0');
  throw new Error(`Unsupported target: ${to}`);
}

export function detectFields(bitRows,minimum=2,split=true) {
  if(bitRows.length<2) return [];
  const len=Math.min(...bitRows.map(x=>x.length)),out=[];
  let i=0;
  while(i<len){
    const signature=bitRows.map(row=>row[i]).join(''),stable=new Set(signature).size===1,start=i;
    i++;
    while(i<len) {
      const next=bitRows.map(row=>row[i]).join('');
      if((new Set(next).size===1)!==stable || (!stable&&split&&next!==signature)) break;
      i++;
    }
    if(i-start>=minimum)out.push({start,end:i,width:i-start,kind:stable?'STABLE':'VARIABLE',example:bitRows[0].slice(start,i)});
  }
  return out;
}

export function analyze(lines,format,minimum,variableMode) {
  const values=lines.filter(s=>s.trim());
  if(values.length<2)return {fields:[],comparedBits:0,valid:values.length,error:null};
  try {
    let bits=values.map(x=>toBits(x.trim(),format));
    if(format==='Decimal') {
      const width=Math.max(...bits.map(v=>v.length));bits=bits.map(v=>v.padStart(width,'0'));
    }
    return {fields:detectFields(bits,minimum,variableMode==='Split by change pattern'),comparedBits:Math.min(...bits.map(v=>v.length)),valid:values.length,error:null};
  } catch(e) {return {fields:[],comparedBits:0,valid:values.length,error:e.message};}
}

export function validateProject(state) {
  if(!state||state.version!==1||typeof state.text!=='string'||!FORMATS.includes(state.format)||!MATCH_MODES.includes(state.match_mode)) throw new Error('Invalid or unsupported Nibbler project');
  if(!Array.isArray(state.groups)||state.groups.length>500)throw new Error('Invalid group collection');
  const groups=state.groups.map(g=>{
    if(!Number.isInteger(g.id)||g.id<1||!MATCH_MODES.includes(g.mode)||!FORMATS.includes(g.encoding)||typeof g.needle!=='string'||!g.needle||!Number.isInteger(g.offset)||g.offset<0||!/^#[0-9a-f]{6}$/i.test(g.color)||!/^#[0-9a-f]{6}$/i.test(g.accent))throw new Error('Invalid group in project');
    return {...g};
  });
  return {text:state.text,format:state.format,delimiter:typeof state.delimiter==='string'?state.delimiter.slice(0,80):'',matchMode:state.match_mode,minimum:Math.max(1,Math.min(128,Number(state.min_field_width)||2)),variableMode:VARIABLE_MODES.includes(state.variable_mode)?state.variable_mode:VARIABLE_MODES[0],groups,nextId:Math.max(Number(state.next_group_id)||1,1,...groups.map(g=>g.id+1))};
}


/** User-specified packet separator. Empty and the literal escape \n represent line breaks. */
export function packetDelimiter(value='') {
  if (!value || value==='\\n' || value==='\n') return '\n';
  if (value==='\\t') return '\t';
  return value;
}

/** Split pasted content into packet rows; existing newlines are always row boundaries. */
export function splitPackets(value,delimiter='') {
  const mark=packetDelimiter(delimiter);
  const normalized=String(value).replace(/\r\n?/g,'\n');
  const chunks=mark==='\n' ? normalized.split('\n') : normalized.split(mark).flatMap(part=>part.split('\n'));
  return chunks.map(s=>s.trim()).filter(Boolean);
}

/** Convert packet rows atomically; a failure must not partially alter the editor. */
export function convertPackets(lines,from,to) {
  if(!FORMATS.includes(from) || !['Hex','Binary','Decimal'].includes(to)) throw new Error('Unsupported conversion format');
  return lines.map((line,index)=>{
    if(!line.trim()) return '';
    try {
      if(from===to) return line;
      const converted=convertField(line.trim(),from,to);
      return to==='Hex'?converted.slice(2):converted;
    } catch(err) {throw new Error(`Packet ${index+1}: ${err.message}`);}
  });
}

/** An overview that uses bytes for Hex, bits for Binary, digits for Decimal,
 * and characters for ASCII / Plain Text. Counts refer to visible units,
 * independent from the minimum width of underlying bit-run detection. */
export function compareUnits(lines,format) {
  const input=lines.filter(s=>s.trim());
  const labels={Hex:['byte','bytes','HEX BYTES · 8 BITS PER BYTE'],Binary:['bit','bits','BINARY · 1 BIT PER CELL'],Decimal:['digit','digits','DECIMAL DIGITS'],ASCII:['character','characters','ASCII CHARACTERS'],'Plain Text':['character','characters','TEXT CHARACTERS']};
  const [singular,plural,heading]=labels[format]||labels.Hex;
  if(input.length<2) return {units:[],stable:0,variable:0,valid:input.length,singular,plural,heading,error:null,compared:0};
  try {
    let series;
    if(format==='Hex') {
      series=input.map(value=>{
        const bits=toBits(value,'Hex'),bytes=[];
        for(let i=0;i<bits.length;i+=8) bytes.push(bits.slice(i,i+8));
        return bytes;
      });
    } else if(format==='Binary')series=input.map(value=>[...toBits(value,'Binary')]);
    else if(format==='Decimal'){
      const raw=input.map(value=>{const s=value.replace(/[\s_]+/g,'');toBits(s,'Decimal');return s;});
      const max=Math.max(...raw.map(s=>s.length));series=raw.map(s=>[...s.padStart(max,'0')]);
    } else {
      series=input.map(value=>{
        toBits(value,format);return Array.from(value);
      });
    }
    const length=Math.min(...series.map(r=>r.length));
    const units=Array.from({length},(_,i)=>{
      const samples=series.map(r=>r[i]);
      const distinct=[...new Set(samples)],stable=distinct.length===1;
      const display=format==='Hex'?parseInt(samples[0],2).toString(16).toUpperCase().padStart(Math.ceil(samples[0].length/4),'0'):samples[0];
      const variants=format==='Hex'?distinct.map(v=>parseInt(v,2).toString(16).toUpperCase().padStart(Math.ceil(v.length/4),'0')):distinct;
      return {index:i,display,stable,variants,partial:format==='Hex' && samples[0].length!==8};
    });
    return {units,stable:units.filter(u=>u.stable).length,variable:units.filter(u=>!u.stable).length,
      singular,plural,heading,valid:input.length,error:null,compared:length};
  }catch(e){return {units:[],stable:0,variable:0,valid:input.length,singular,plural,heading,error:e.message,compared:0};}
}

/** Merge touching low-level fields of identical state for a legible comparison.
 * A gap produced by minimum-width filtering is never silently bridged. */
export function mergeFieldRuns(fields) {
  const merged=[];
  for(const field of fields){
    const last=merged.at(-1);
    if(last&&last.kind===field.kind&&last.end===field.start){
      last.end=field.end;last.width=last.end-last.start;last.example+=field.example;last.segments++;
    }else merged.push({...field,segments:1});
  }
  return merged;
}
