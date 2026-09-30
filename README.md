# YouTube Studio – Tradução múltipla

## Setup

1. chrome://extensions → Modo desenvolvedor → Carregar sem compactação → pasta `extension/`
2. Abra https://studio.youtube.com/video/<ID>/translations e clique em "Tradução múltipla".
3. Instale em sua máquina o server `free-translate-api` seguindo tutorial do repositório: https://github.com/ismalzikri/free-translate-api
4. Via terminal acesse a pasta do `free-translate-api` e inicie o server com o comando: `go run main.go` para liberar o endereço `localhost:8000` para extensão realizar as traduções
