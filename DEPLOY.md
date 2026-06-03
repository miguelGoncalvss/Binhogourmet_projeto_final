# Guia de Lançamento (Deploy)

Este projeto foi preparado para ser lançado hoje, seguindo suas instruções.

## 1. Backend (Firebase)

O backend foi migrado de SQLite para **Firestore** e adaptado para rodar em **Firebase Functions**.

### Passos no Firebase:
1.  **Instale as ferramentas do Firebase** (caso não tenha):
    ```bash
    npm install -g firebase-tools
    ```
2.  **Faça login**:
    ```bash
    firebase login
    ```
3.  **Instale as dependências no backend**:
    ```bash
    cd backend
    npm install
    cd ..
    ```
4.  **Faça o deploy**:
    ```bash
    firebase deploy --only functions
    ```
5.  **Atenção**: Após o deploy, o Firebase fornecerá uma URL (ex: `https://us-central1-binho-gourmet.cloudfunctions.net/api`). Ela já está configurada no seu frontend, mas verifique se o ID do projeto está correto no `.firebaserc`.

## 2. Frontend (Vercel)

O frontend foi configurado para o Vercel.

### Passos no Vercel:
1.  Crie um novo projeto no Vercel importando este repositório.
2.  **Root Directory**: Defina como `frontend`.
3.  **Framework Preset**: Selecione `Vite`.
4.  **Environment Variables**:
    - Adicione `VITE_API_URL` com a URL do seu backend Firebase (ex: `https://us-central1-binho-gourmet.cloudfunctions.net/api`).
5.  Clique em **Deploy**.

## Mudanças Realizadas:
- **Backend**:
  - `index.js`: Migração completa de SQLite para Firestore.
  - `package.json`: Adicionadas dependências do Firebase e configurado Node 18.
  - `serviceAccountKey.json`: Salva a chave fornecida (usada para o Firestore).
  - Aumentada a memória da função para **2GB** (necessário para o OCR/Tesseract).
- **Frontend**:
  - `.env.production`: Configurado para usar a URL do Firebase.
  - `vercel.json`: Adicionado para suporte a SPA (Single Page Application) no Vercel.

**Dica**: Ao subir pela primeira vez, o sistema criará automaticamente o usuário `binho@local` com a senha `admin123`.
