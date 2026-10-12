import * as THREE from "./vendor/three.module.min.js";
import { FUTURE_COLORS, cellRing } from "./future-model.js";

export function futureImage(b, result, showTrees = true) {
  const canvas = document.createElement("canvas");
  // One pixel per analysis cell; transparent gaps keep the underlying aerial image visible.
  canvas.width = b.width; canvas.height = b.height;
  const ctx=canvas.getContext("2d"), pixels=ctx.createImageData(b.width,b.height);
  const rgb=(hex)=>[1,3,5].map((i)=>parseInt(hex.slice(i,i+2),16));
  const colors=Object.fromEntries(Object.entries(FUTURE_COLORS).map(([k,v])=>[k,rgb(v)]));
  for(let i=0;i<b.flags.length;i++) {
    if(b.insideFraction[i]<=0)continue;
    let color,alpha;
    if(result.housingSet.has(i)){color=colors.housing;alpha=185;}
    else if(showTrees && result.gainSet.has(i)){color=colors.gain;alpha=165;}
    else if(showTrees && result.lossSet.has(i)){color=colors.loss;alpha=160;}
    else if(showTrees && b.treeFraction[i]>0){color=colors.trees;alpha=Math.round(90*b.treeFraction[i]);}
    else continue;
    pixels.data.set([...color,Math.round(alpha*b.insideFraction[i])],i*4);
  }
  ctx.putImageData(pixels,0,0);
  if(b.boundary) {
    const width=b.extent[2]-b.extent[0],depth=b.extent[3]-b.extent[1];
    ctx.globalCompositeOperation="destination-in";ctx.fillStyle="white";ctx.beginPath();
    for(const ring of b.boundary) {
      ring.forEach(([x,n],i)=>{const px=(x/width+.5)*canvas.width,py=(.5-n/depth)*canvas.height;i?ctx.lineTo(px,py):ctx.moveTo(px,py);});
      ctx.closePath();
    }
    ctx.fill();ctx.globalCompositeOperation="source-over";
  }
  return canvas;
}

export class FutureView {
  constructor(world, geometry, model) {
    this.model=model;
    this.group=new THREE.Group();world.add(this.group);
    this.texture=new THREE.Texture();this.texture.colorSpace=THREE.SRGBColorSpace;
    this.texture.minFilter=THREE.NearestFilter;this.texture.magFilter=THREE.NearestFilter;
    this.overlay=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({map:this.texture,transparent:true,
      depthWrite:false,polygonOffset:true,polygonOffsetFactor:-3,polygonOffsetUnits:-3}));
    this.overlay.position.y=2;this.overlay.renderOrder=2;this.group.add(this.overlay);
    this.blocks=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshStandardMaterial({
      color:FUTURE_COLORS.housing,transparent:true,opacity:0.76,roughness:1}));
    this.group.add(this.blocks);
  }
  update(settings, baseline, result) {
    this.group.visible=Boolean(settings?.enabled && baseline && result);
    if(!this.group.visible)return;
    const key=result.key+String(settings.trees);
    if(this.key===key)return;
    this.key=key;this.texture.image=futureImage(baseline,result,settings.trees);this.texture.needsUpdate=true;
    const vertices=[];
    for(const i of result.housing) {
      const ring=cellRing(baseline,i,2);
      const shape=new THREE.Shape(ring.map((p)=>new THREE.Vector2(...p)));
      const g=new THREE.ExtrudeGeometry(shape,{depth:6,bevelEnabled:false,curveSegments:1});g.rotateX(-Math.PI/2);
      const a=g.attributes.position;
      const roof=Math.max(...ring.map(([x,n])=>this.model.elevation(x,n)))-this.model.data.minimumElevation+7;
      for(let k=0;k<a.count;k++) {
        const h=this.model.elevation(a.getX(k),-a.getZ(k))-this.model.data.minimumElevation;
        vertices.push(a.getX(k),a.getY(k)>3?roof:h+2,a.getZ(k));
      }
      g.dispose();
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute("position",new THREE.Float32BufferAttribute(vertices,3));geometry.computeVertexNormals();
    this.blocks.geometry.dispose();this.blocks.geometry=geometry;
  }
}
