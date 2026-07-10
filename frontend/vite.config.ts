import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 4747,
    strictPort: true,
    proxy: {
      // 로컬 개발: backend(:4746)로 API 프록시
      '/api': 'http://localhost:4746',
    },
  },
  build: {
    target: 'es2022',
  },
});
