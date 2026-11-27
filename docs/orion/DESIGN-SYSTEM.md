# ORION – Design system (OR-004), primeira camada

Status: provisório. Os arquivos aprovados de marca (símbolo, tipografia metálica) não estavam no repositório, então a paleta e o símbolo abaixo são uma proposta a validar.

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
- Barra lateral/cabeçalho em azul-marinho, marca ORION com a assinatura "Seu Assistente Pessoal" e símbolo orbital provisório.
- Título da página e `theme-color` do navegador.

## O que ainda NÃO muda
- Cartões, botões, tela inicial e barra inferior seguem verdes (Green Wallet). No celular o cabeçalho azul destoa do resto até as próximas camadas.
- No desktop a barra lateral é só de ícones (layout atual), então o nome ORION não aparece; só o símbolo.
- `manifest.webmanifest`, ícones do PWA e textos do app continuam FinanFlow. Trocar isso afeta quem já instalou o app e depende da decisão de lançamento.

## Próximos incrementos sugeridos
1. Trocar o símbolo e a tipografia pelos arquivos aprovados.
2. Reaplicar os tokens nos componentes (cartões, botões, formulários) e consolidar os 5 CSS de remendo.
3. Definir a barra lateral expandida no desktop com o nome.
4. Só então: manifest, ícones e textos.
