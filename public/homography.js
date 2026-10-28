'use strict';
// Maps a w x h rectangle onto an arbitrary quad (4-corner keystone) and
// returns the CSS matrix3d() string. Works in browser and Node (for tests).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Homography = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // Solve A x = b by Gaussian elimination with partial pivoting.
  function solve(A, b) {
    const n = b.length;
    const M = A.map((row, i) => [...row, b[i]]);
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-12) return null;
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = c + 1; r < n; r++) {
        const f = M[r][c] / M[c][c];
        for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    const x = new Array(n);
    for (let r = n - 1; r >= 0; r--) {
      let s = M[r][n];
      for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
      x[r] = s / M[r][r];
    }
    return x;
  }

  // quad: [[x,y] x4] ordered TL, TR, BR, BL. Returns [a,b,c,d,e,f,g,h] with
  //   X = (a x + b y + c) / (g x + h y + 1),  Y = (d x + e y + f) / (g x + h y + 1)
  function fromRect(w, h, quad) {
    const src = [[0, 0], [w, 0], [w, h], [0, h]];
    const A = [];
    const B = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = src[i];
      const [X, Y] = quad[i];
      A.push([x, y, 1, 0, 0, 0, -X * x, -X * y]);
      B.push(X);
      A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]);
      B.push(Y);
    }
    return solve(A, B);
  }

  function matrix3d(w, h, quad) {
    const H = fromRect(w, h, quad);
    if (!H) return 'none';
    const [a, b, c, d, e, f, g, hh] = H;
    // CSS matrix3d is column-major.
    return `matrix3d(${a},${d},0,${g},${b},${e},0,${hh},0,0,1,0,${c},${f},0,1)`;
  }

  function apply(H, x, y) {
    const [a, b, c, d, e, f, g, h] = H;
    const k = g * x + h * y + 1;
    return [(a * x + b * y + c) / k, (d * x + e * y + f) / k];
  }

  return { fromRect, matrix3d, apply };
});
