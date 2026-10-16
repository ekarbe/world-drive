// Shared materials. The world material uses vertex colours, and overlays a window texture
// on building facades: texture alpha selects between the vertex colour and the window colour.

import * as THREE from 'three';

function makeWindowTexture() {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d');
  g.clearRect(0, 0, S, S);
  // window pane
  const grad = g.createLinearGradient(0, 14, 0, 50);
  grad.addColorStop(0, '#9fc4de');
  grad.addColorStop(1, '#4f7593');
  g.fillStyle = grad;
  g.fillRect(14, 14, 36, 34);
  // frame
  g.fillStyle = 'rgba(40,50,60,1)';
  g.fillRect(14, 30, 36, 2);
  g.fillRect(31, 14, 2, 34);
  // reflection
  g.fillStyle = 'rgba(255,255,255,0.35)';
  g.fillRect(17, 17, 6, 10);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

let worldMat = null;

export function getWorldMaterial() {
  if (worldMat) return worldMat;
  const tex = typeof document !== 'undefined' ? makeWindowTexture() : null;
  worldMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: tex });
  worldMat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <map_fragment>', '')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
#ifdef USE_MAP
  vec4 wTex = texture2D( map, vMapUv );
  diffuseColor.rgb = mix( diffuseColor.rgb, wTex.rgb, wTex.a );
#endif`,
      );
  };
  return worldMat;
}
