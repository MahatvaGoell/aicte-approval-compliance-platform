// Small complete synthetic PDFs for edge cases, with correct xref offsets. No fixture labels in this author.
export function syntheticPdf(lines:string[],options:{pages?:number;rotation?:number;crop?:boolean;userUnit?:number;content?:string;openAction?:string}={}):Buffer {
  const literal=(s:string)=>s.replace(/[\\()]/g,'\\$&');
  const count=options.pages??1;
  const objects:string[]=['<< /Type /Catalog /Pages 2 0 R'+(options.openAction?` /OpenAction << /S /JavaScript /JS (${literal(options.openAction)}) >>`:'')+' >>',
    `<< /Type /Pages /Count ${count} /Kids [${Array.from({length:count},(_,i)=>`${4+i*2} 0 R`).join(' ')}] >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  for(let page=0;page<count;page++) {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 840] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5+page*2} 0 R /Rotate ${options.rotation??0}${options.crop?' /CropBox [25 25 575 815]':''}${options.userUnit?` /UserUnit ${options.userUnit}`:''} >>`);
    const stream=page===0?(options.content??'BT /F1 12 Tf 1 0 0 1 50 700 Tm '+lines.map((line,index)=>(index?'0 -26 Td ':'')+`(${literal(line)}) Tj`).join('\n')+' ET'):'';
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  let pdf='%PDF-1.6\n',offsets=[0];
  objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${index+1} 0 obj\n${object}\nendobj\n`;});
  const xref=Buffer.byteLength(pdf);
  pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('');
  pdf+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}
