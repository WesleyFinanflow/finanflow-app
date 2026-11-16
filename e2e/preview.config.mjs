// Isolated same-origin proxy equivalent to production's /api rewrite.
export default { preview: { proxy: { "/api": { target: "http://127.0.0.1:4392", changeOrigin: true } } } };
