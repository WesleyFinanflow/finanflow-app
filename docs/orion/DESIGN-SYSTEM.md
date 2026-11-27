# ORION – Design system (OR-004), primeira camada

Status: o símbolo e o logotipo metálico são os arquivos aprovados (recebidos em 27/11/2026). A paleta de interface abaixo continua sendo uma proposta a validar.

## Arquivos da marca
- `frontend/src/assets/orion/orion-symbol.webp` (símbolo orbital) e `orion-wordmark.webp` (logotipo "ORION"), com fundo transparente.
- Origem: três imagens raster entregues com fundo escuro embutido. O fundo foi removido usando a luminância como transparência (o brilho azul vira translúcido) e as imagens foram recortadas e reduzidas. Servem para fundos escuros; sobre fundo claro não funcionam.
- A assinatura "Seu Assistente Pessoal" fica como texto real (legível e acessível), não como imagem.
- Os originais não foram versionados no repositório.

## Como ver
- Padrão: o app continua FinanFlow, sem nenhuma mudança visual.
- Prévia ORION: abrir `/?brand=orion` (fica salva no navegador). Voltar: `/?brand=finanflow`.
- Ativar para todos no build: variável `VITE_ORION_BRAND=true` no frontend.

## Tokens (`frontend/src/orion-tokens.js` é a fonte; `orion-theme.css` espelha)
| Token | Valor | Uso |
|---|---|---|
| `--orion-navy-900` | `#0B1F3A` | fundo principal escuro |
| `--orion-navy-800` | `#12294A` | fundo escuro secundário |
| `--orion-silver-300` | `#C7D0DC` | texto secundário em fundo escuro (acabamento prateado) |
| `--orion-sky-300` | `#6CB2FF` | destaque e foco em fundo escuro |
| `--orion-blue-700` | `#1F5FB0` | destaque em fundo claro |
| `--orion-slate-600` | `#51607A` | texto secundário em fundo claro |
| `--orion-mist-50` | `#F4F7FB` | fundo claro |
| `--orion-white` | `#FFFFFF` | texto em fundo escuro |

Acessibilidade: todos os pares texto/fundo usados atingem WCAG AA (mínimo 4,5:1; o menor medido é 5,9:1). `orion-tokens.test.js` falha se algum par ou valor divergir.

## O que esta camada muda (com a flag ligada)
- Barra lateral/cabeçalho em azul-marinho, com o símbolo e o logotipo metálico oficiais e a assinatura "Seu Assistente Pessoal" (no celular; no desktop a barra só mostra o símbolo).
- Título da página e `theme-color` do navegador.

## O que ainda NÃO muda
- Cartões, botões, tela inicial e barra inferior seguem verdes (Green Wallet). No celular o cabeçalho azul destoa do resto até as próximas camadas.
- No desktop a barra lateral é só de ícones (layout atual), então o nome ORION não aparece; só o símbolo.
- `manifest.webmanifest`, ícones do PWA e textos do app continuam FinanFlow. Trocar isso afeta quem já instalou o app e depende da decisão de lançamento.

## Próximos incrementos sugeridos
1. Obter a marca em vetor (SVG) ou em alta resolução com fundo transparente, e gerar os ícones do PWA (192, 512, maskable e 180) a partir do símbolo. As imagens atuais são raster e a extração do fundo é uma aproximação.
2. Reaplicar os tokens nos componentes (cartões, botões, formulários) e consolidar os 5 CSS de remendo.
3. Definir a barra lateral expandida no desktop com o nome.
4. Só então: manifest, ícones e textos.
