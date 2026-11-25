function parseLabel(value){
 const raw=String(value??'').trim().replaceAll('\u0000','');
 if(![18,23].includes(raw.length))throw Error(`La etiqueta debe tener 18 o 23 caracteres; recibí ${raw.length}.`);
 const cut=raw.length===18?8:13;
 const original=raw.slice(0,cut).toUpperCase().replace(/^0+(?=.)/,'').trim();
 const qty=raw.slice(cut,cut+5),id=raw.slice(cut+5,cut+10);
 if(!original)throw Error('La etiqueta no contiene artículo.');
 if(!/^\d{5}$/.test(qty)||Number(qty)<=0)throw Error('Cantidad inválida en la etiqueta.');
 if(!/^\d{5}$/.test(id)||Number(id)<=0)throw Error('ID de etiqueta inválido.');
 return {sku:original,qty:Number(qty),labelId:Number(id),raw};
}
function parseClientOrder(value){const cleaned=String(value??'').trim().replaceAll("'",'-');
 const m=cleaned.match(/^(\d+)-(\d+)$/);return m?{clientId:String(Number(m[1])),orderNo:String(Number(m[2]))}:null;
}
module.exports={parseLabel,parseClientOrder};
