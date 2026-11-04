import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build:play` → 모든 코드를 HTML 한 파일에 넣은 play.html 생성
// (파일을 더블클릭해서 file:// 로 열어도 동작)
export default defineConfig(({ mode }) => ({
  base: './',
  server: { host: true },
  plugins: mode === 'play' ? [viteSingleFile()] : [],
  build: {
    chunkSizeWarningLimit: 2000,
    outDir: mode === 'play' ? '.play-build' : 'dist',
  },
}));
