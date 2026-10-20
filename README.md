# King of The Animals

Party game no navegador: 2 a 8 bichos (pessoas ou bots) se empurram com dash para fora de uma arena que encolhe. Melhor de 5, um cenário por rodada, power-ups, emotes e a coroa do campeão. O GDD é a fonte da verdade.

## Rodar

```bash
npm install
npm run dev      # servidor + cliente juntos em http://localhost:3000
npm run build    # gera client/dist
npm start        # produção: serve client/dist e as salas na mesma porta
```

Node 20.6 ou mais novo.

## Deploy no Render (grátis)

O repositório já vem com o `render.yaml` (Blueprint). O Render lê esse arquivo e configura tudo sozinho: build, start, checagem de saúde em `/healthz`, Node 22 e região Virginia, a mais perto do Brasil.

1. **Suba este projeto para o GitHub.** O repositório Git já está pronto, com commit.
   - Com GitHub Desktop: *File → Add local repository* → escolha esta pasta → *Publish repository*.
   - Pelo terminal: crie um repositório vazio no GitHub e rode `git remote add origin <url> && git push -u origin main`.
2. **No Render:** [dashboard.render.com](https://dashboard.render.com) → **New → Blueprint** → conecte o GitHub e escolha o repositório → **Apply**.
3. Espere o primeiro build (2 a 4 minutos). O endereço fica parecido com `https://king-of-the-animals.onrender.com`.

O WebSocket funciona direto no Render. A cada `git push` ele faz deploy de novo sozinho.

No plano grátis o servidor dorme depois de 15 minutos sem ninguém e leva uns 50 segundos para acordar. Abra o link um minuto antes de chamar o pessoal. As salas ficam na memória, então um deploy novo derruba quem estiver jogando.

Sem o Blueprint (Web Service manual), a configuração é:

- **Build:** `npm ci && npm run build`
- **Start:** `npm start`
- **Health check:** `/healthz`

## Como jogar

No menu, digite seu nome (ele aparece em cima do bicho) e escolha:

- **Single Player:** você contra bots. Roda no navegador e funciona sem internet depois de carregado.
- **Multiplayer:** cria uma sala e mostra o link de convite. Quem abre o link cai no menu com o botão "Join room".


| Ação | Teclado | Gamepad | Celular |
| --- | --- | --- | --- |
| Mover | WASD / setas | analógico esquerdo | joystick à esquerda |
| Dash | Espaço | A / X | botão DASH |
| Emotes | 1 a 4 | direcional | botões no topo |

## Atalhos de debug

Ficam ligados em `npm run dev`. Em produção, só valem com `?debug=1`.

| URL | O que faz |
| --- | --- |
| `?debug=1` | FPS, ping, tick e círculos de colisão; expõe `kota.state()` no console |
| `?bots=7&difficulty=hard` | entra direto na partida com bots |
| `?scenario=lava` | força um cenário (`sky`, `frozen`, `desert`, `lava`, `neon`) |
| `?round=4` | começa na rodada 4 |
| `?powerup=bomb` | só esse power-up (`coffee`, `bomb`, `heavy`, `soap`), a cada 2 s |
| `?slowmo=0.3` | simulação em câmera lenta |
| `?nofall=1` | ninguém cai |
| `?predict=0` | desliga a previsão do próprio bicho (para comparar o lag) |
| `?offline=1&bots=3` | entra direto no Single Player (o `server/game.js` roda no navegador) |

## Onde mexer

- **`shared/constants.js`:** física, tempos, power-ups, bots e cenários. É o lugar de ajustar o jogo.
- **`shared/messages.js`:** contrato de rede.
- **`server/game.js`:** simulação de 30 Hz. JavaScript puro, que também roda no navegador.
- **`server/bots.js`:** IA dos bots.
- **`server/rooms.js`:** salas.
- **`client/src/main.js`:** fluxo de telas, previsão do próprio bicho e interpolação dos outros (100 ms, sobe sozinho até 400 ms se a conexão engasgar).
- **`client/src/scene.js`:** câmera, arena e cenários.
- **`client/src/scenery.js`:** profundidade dos cenários: coluna de pedra, paredões do cânion, ilhas, pilares e fundo do abismo.
- **`client/src/animals.js`:** modelos e animações.
- **`client/src/fx.js`:** mapa de eventos (sons, partículas, tremor).
- **`client/src/input.js`:** teclado, gamepad e celular.
- **`client/src/ui.js`:** telas.
- **`client/src/strings.js`:** textos em inglês.
- **`client/public/assets.json`:** manifesto dos assets.

## Créditos (todos CC0)

- Bichos, props, partículas e sons: [Kenney](https://kenney.nl). Os bichos são do pack Cube Pets; árvores, pedras, cactos e colunas dos cenários, do Nature Kit.
- Música: TechnoByte, de [Yueki](https://yuekistimky.itch.io/technobyte).
- Alguns sons curtos (whoosh, boing, poof, beep, alarme) foram gerados para o jogo e também são CC0.
