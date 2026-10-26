import type { Bbox,PageSource,SourceLine,SourceSpan } from './types.js';

export function union(boxes:Bbox[]):Bbox {
  return [Math.min(...boxes.map(b=>b[0])),Math.min(...boxes.map(b=>b[1])),Math.max(...boxes.map(b=>b[2])),Math.max(...boxes.map(b=>b[3]))];
}
/** Layout order uses the unrotated viewport; evidence boxes use the displayed, rotated viewport. */
export function sourceLines(page:PageSource):SourceLine[] {
  const spans=[...page.spans].sort((a,b)=>a.baseline-b.baseline||a.layoutBox[0]-b.layoutBox[0]);
  const groups:SourceSpan[][]=[];
  for(const span of spans) {
    const group=groups.at(-1),first=group?.[0];
    if(!first||Math.abs(span.baseline-first.baseline)>Math.max(1.5,Math.min(span.height,first.height)*.2))groups.push([span]);
    else group!.push(span);
  }
  const result:SourceLine[]=[];
  for(const group of groups) {
    group.sort((a,b)=>a.layoutBox[0]-b.layoutBox[0]);
    let line:SourceLine|null=null,previous:SourceSpan|null=null;
    for(const span of group) {
      const gap=previous?span.layoutBox[0]-previous.layoutBox[2]:0;
      // Separate columns/overlapping runs instead of assigning one column's label to another value.
      if(!line||!previous||gap>Math.max(48,span.height*4)||gap<-.5) {
        line={page:page.page,text:'',bbox:span.bbox,layoutBox:span.layoutBox,height:span.height,runs:[]};result.push(line);previous=null;
      }
      if(previous&&gap>Math.max(.75,span.height*.15)&&!line.text.endsWith(' ')&&!span.text.startsWith(' '))line.text+=' ';
      const start=line.text.length;line.text+=span.text;
      line.runs.push({start,end:line.text.length,bbox:span.bbox});
      line.bbox=union([line.bbox,span.bbox]);line.layoutBox=union([line.layoutBox,span.layoutBox]);
      line.height=Math.max(line.height,span.height);previous=span;
    }
  }
  return result;
}
