import sharp from 'sharp'
const [,, src, x, y, w, h, out, scale] = process.argv
await sharp(src).extract({ left:+x, top:+y, width:+w, height:+h }).resize({ width: Math.round(+w * (+scale||3)), kernel:'nearest' }).jpeg({quality:92}).toFile(out)
console.log('wrote', out)
