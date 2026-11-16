# do 시리즈 아이콘 가이드

dogroo·donoti·docook·doquiz 의 PWA 아이콘·파비콘·워드마크를 같은 규칙으로 만든다. 새 앱을 추가하거나 아이콘을 고칠 때 이 문서를 따른다.

## 원칙

- **마크는 단색 평면 그림 하나.** 색 하나로 채운 단순한 실루엣만 쓴다. 그라디언트·하이라이트·그림자·반짝이 같은 장식과 보조 요소는 넣지 않는다.
  - 내부 디테일이 필요하면 다른 색으로 칠하지 말고 구멍(mask)으로 뚫는다. 예: doquiz 말풍선 안의 물음표.
  - 192px 이하에서도 알아볼 수 있을 만큼 단순해야 한다. 기준은 dogroo 새싹, donoti 확성기다.
- **아이콘에는 글자를 넣지 않는다.** 앱 이름은 홈 화면이 아이콘 아래에 표시한다.
- **앱 안의 이름은 워드마크 이미지로 쓴다.** 로그인 화면과 헤더에는 `두그루` 같은 한글 텍스트 대신 `logo-text` 워드마크(영문 소문자, Quicksand Bold)를 쓴다.
  - 한글 이름은 `manifest.webmanifest` 의 `name`·`short_name`, `<title>`, `apple-mobile-web-app-title`, `alt` 에만 남긴다.

## 앱별 색

| 앱 | 마크 | 아이콘 배경 | 워드마크 | 마크 |
|---|---|---|---|---|
| dogroo | `#3d8b46` | `#e6f2e9` | 진녹색 (webp) | 새싹 |
| donoti | `#e64c45` | `#fed3cc` | 빨강 (png) | 확성기 |
| docook | `#d9622b` | `#fbe9dd` | `#c4521d` | 냄비 |
| doquiz | `#3182f6` | `#e3edfd` | `#1b64da` | 말풍선 물음표 |

새 앱의 배경은 마크 색을 아주 옅게 푼 색(명도 90% 이상)으로 정한다.

## 아이콘 구성 (512 캔버스)

`assets/compose-icons.py` 가 마크 SVG 하나와 배경색으로 두 가지 아이콘 SVG를 만든다. 마크는 실제로 그려진 외곽을 기준으로 상자에 맞춘다(viewBox 여백은 무시한다).

| 파일 | 배경 | 마크 크기 | 용도 |
|---|---|---|---|
| `icon.svg` | 꽉 찬 단색 | 외곽 긴 변 300px, 정중앙 | `icon-180`(iOS 홈 화면), `icon-192`, `icon-512` |
| `icon-maskable.svg` | 꽉 찬 단색 | 외곽 긴 변 230px, 정중앙 | `icon-512-maskable` (안드로이드 적응형) |

- 마스커블 아이콘은 런처가 원·둥근 사각형으로 잘라 낸다. 마크가 중앙 80% 원(지름 410px) 안에 들어가야 하는데, 230px 상자의 대각선이 약 325px 라서 안전하다.
- 모서리를 둥글게 깎거나 테두리를 넣지 않는다. 둥근 모양은 OS 가 만든다.

## 파일 구성 (각 앱 리포)

```
assets/
├── <앱>-mark.svg        # 마크 원본 (벡터) - 아이콘·파비콘의 유일한 소스
├── <앱>-text.svg        # 워드마크 원본 (docook·doquiz 는 생성기가 출력)
├── icon.svg             # compose-icons.py 출력
├── icon-maskable.svg    # compose-icons.py 출력
└── generate-logo.mjs    # (docook·doquiz) 마크·워드마크 SVG 생성기
frontend/public/
├── icons/icon-180.png · icon-192.png · icon-512.png · icon-512-maskable.png
├── favicon.png (48) · favicon.ico (48·32·16)
└── logo-text.webp|png   # 앱 안 워드마크
```

- dogroo·donoti 의 마크 SVG 는 이전 아이콘 PNG 에서 potrace 로 벡터화한 것이다. 고칠 때는 이 SVG 를 직접 고친다.
- dogroo `assets/` 의 `dogroo.webp`·`dogroo-mark.webp`, donoti `assets/` 의 `donoti-icon.png`·`donoti-glyph.png` 는 초기 시안이라 지금 아이콘과 다르다. 소스로 쓰지 않는다.

## 재생성 명령

필요한 도구는 `rsvg-convert`(librsvg), `magick`(ImageMagick 7), `python3` + Pillow 이다. 앱 리포 루트에서 실행하고, dogroo 리포가 `../dogroo` 에 있다고 가정한다. 배경색은 위 표에서 가져온다.

```sh
APP=doquiz BG='#e3edfd'
python3 ../dogroo/assets/compose-icons.py assets/$APP-mark.svg "$BG" assets
for s in 180 192 512; do rsvg-convert -w $s assets/icon.svg -o frontend/public/icons/icon-$s.png; done
rsvg-convert -w 512 assets/icon-maskable.svg -o frontend/public/icons/icon-512-maskable.png
# 파비콘 = 배경 없는 마크
rsvg-convert -w 48 assets/$APP-mark.svg -o frontend/public/favicon.png
rsvg-convert -w 256 assets/$APP-mark.svg | magick - -define icon:auto-resize=48,32,16 frontend/public/favicon.ico
# 워드마크 (폭 406px, 무손실 webp)
rsvg-convert -w 406 assets/$APP-text.svg | magick - -define webp:lossless=true frontend/public/logo-text.webp
```

docook·doquiz 처럼 생성기가 있으면 먼저 마크·워드마크 SVG를 다시 만든다. 사용법은 각 `generate-logo.mjs` 맨 위 주석에 있다(빈 폴더에 복사 → `npm i opentype.js@1.3.4 @fontsource/quicksand@5.1.0` → `node generate-logo.mjs <출력폴더>`).

## 앱 안 워드마크

- 로그인 화면은 `.logo img { width: 170px; filter: var(--logo-filter); }` 로 쓴다.
- 헤더에 넣을 때는 높이 22~28px 로 쓴다.
- 다크 모드에서는 `--logo-filter: brightness(0) invert(0.85~0.9)` 로 밝은 회색으로 바꾼다. 라이트 모드 값은 `none` 이다. 토큰은 `index.html` 의 테마 토큰에 둔다.

## 새 앱 체크리스트

1. 마크를 200x200 viewBox 의 단색 SVG 로 그린다. → `assets/<앱>-mark.svg`
2. 워드마크 SVG 를 만든다(Quicksand Bold, 영문 소문자). → `assets/<앱>-text.svg`
3. 위의 재생성 명령을 실행한다.
4. `manifest.webmanifest` 의 `background_color`·`theme_color` 와 `index.html` 의 `apple-touch-icon`·`icon` 링크를 확인한다.
5. 네 앱 아이콘을 한 장에 나란히 놓고 마크의 크기와 무게감이 맞는지 본다.
   ```sh
   magick montage ../{dogroo,donoti,docook,doquiz}/frontend/public/icons/icon-512.png -geometry 256x256+8+8 /tmp/do-icons.png
   ```
6. 이 문서의 앱별 색 표에 새 앱을 추가한다.
