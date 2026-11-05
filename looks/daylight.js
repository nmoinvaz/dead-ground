// Daylight: a clear afternoon under a blue sky, in full colour with a firm contrast, and no pass of its own.
(() => {
  Looks.add({
    name: 'daylight', title: 'Daylight', said: 'Daylight.', vivid: 1, hidden: true,
    light: (th, SUN) => Object.assign({}, th, {
      name: th.name + ' day', sun: SUN(-0.62, 0.82), sunColor: 0xfff2dc, sunPower: 3.2, hemi: [0x8db4ee, 0x6a5a46, 1.1],
      env: [0x4f7fb2, 0xc2d6ea, 0x584a3a], haze: 0xc4d8ee, hazeK: 0.0035,
    }),
  });
})();
