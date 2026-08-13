'use strict';
/** Backfill/replace product images from CSV image_url. */
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const { createPool, loadBackendEnv } = require('../utils/dbConfig');
const { normalizeScannedSku } = require('../utils/generateProductSku');
loadBackendEnv();
const CSV = process.argv.find(a => a.startsWith('--file='))?.slice(7);
const COMMIT = process.argv.includes('--commit');
const IMAGE_DIR = path.join(__dirname, '..', 'uploads', 'products');
const PREFIX = '/uploads/products';

function parseCSV(t){const rows=[];let f='',row=[],q=false;for(let i=0;i<t.length;i++){const c=t[i];if(q){if(c==='"'){if(t[i+1]==='"'){f+='"';i++;}else q=false;}else f+=c;}else{if(c==='"')q=true;else if(c===','){row.push(f);f='';}else if(c==='\r'){}else if(c==='\n'){row.push(f);rows.push(row);row=[];f='';}else f+=c;}}if(f.length||row.length){row.push(f);rows.push(row);}return rows;}

async function dl(url) {
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error('HTTP '+r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  let ext = (url.match(/\.(png|jpe?g|gif|webp)/i)||[])[1]||'jpg';
  ext = ext.toLowerCase().replace('jpeg','jpg');
  const fn = `product-image-${Date.now()}-${Math.round(Math.random()*1e9)}.${ext}`;
  await fsp.mkdir(IMAGE_DIR,{recursive:true});
  await fsp.writeFile(path.join(IMAGE_DIR,fn),buf);
  return `${PREFIX}/${fn}`;
}

(async()=>{
  const rows=parseCSV(fs.readFileSync(CSV,'utf8'));
  const h=rows[0].map(x=>x.trim()); const idx={}; h.forEach((x,i)=>idx[x]=i);
  const g=(r,k)=>(idx[k]!=null?(r[idx[k]]||'').trim():'');
  const map=new Map();
  for(const r of rows.slice(1)){
    const sku=normalizeScannedSku(g(r,'sku')); const img=g(r,'image_url'); const name=g(r,'name');
    if(sku&&img) map.set(sku,{img,name:name||sku}); // any row with image counts
  }
  console.log('CSV with images:',map.size,'commit:',COMMIT);
  const pool=createPool();
  let added=0,replaced=0,fail=0,skip=0;
  for(const [sku,rec] of map){
    const [p]=await pool.query('SELECT id FROM products WHERE sku=? LIMIT 1',[sku]);
    if(!p.length){skip++;continue;}
    const pid=p[0].id;
    const [imgs]=await pool.query('SELECT id,image_url FROM product_images WHERE product_id=?',[pid]);
    const hasLocal=imgs.some(i=>String(i.image_url).startsWith('/uploads/products/'));
    const hasExternal=imgs.some(i=>/^https?:\/\//i.test(i.image_url));
    const needs=!imgs.length||hasExternal;
    if(!needs){skip++;continue;}
    if(!COMMIT){added+=!imgs.length?1:0;replaced+=imgs.length?1:0;continue;}
    try{
      const local=await dl(rec.img);
      if(imgs.length){await pool.query('DELETE FROM product_images WHERE product_id=?',[pid]);replaced++;}
      else added++;
      await pool.query('INSERT INTO product_images (product_id,image_url,alt_text,is_primary,sort_order) VALUES (?,?,?,1,0)',[pid,local,rec.name.slice(0,200)]);
    }catch(e){fail++;if(fail<5)console.log('fail',sku,e.message);}
  }
  await pool.end();
  console.log({added,replaced,skip,fail});
})();
