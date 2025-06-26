const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
require('dotenv').config();

const app = express();
app.use(express.json()); 



const DOWNLOAD_FOLDER = path.join(__dirname, 'downloads');

const SIGNNOW = {
  username: process.env.SIGNNOW_USERNAME,
  password: process.env.SIGNNOW_PASSWORD,
  scope: process.env.SIGNNOW_SCOPE,
  grant_type: process.env.SIGNNOW_GRANT_TYPE,
  expiration_time: process.env.SIGNNOW_EXPIRATION_TIME,
  basicToken: process.env.SIGNNOW_BASIC_TOKEN
};

const INVITE_SETTINGS = {  
  role: 'Signer 1',
  from: 'associacao_comercial@acsp.com.br',
  subject: 'Favor assinar o documento',
  message: 'Olá, você foi convidado a assinar o documento.'
};

function gerarLinkDownloadGoogleDrive(fileId) {
  return `https://drive.google.com/uc?export=download&id=${fileId}`;
}

async function downloadFromGoogleDrive(fileId, pastaDestino, nomeArquivo) {
  const url = gerarLinkDownloadGoogleDrive(fileId);
  const destino = path.join(pastaDestino, nomeArquivo);

  if (!fs.existsSync(pastaDestino)) {
    fs.mkdirSync(pastaDestino, { recursive: true });
  }

  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream',
  });

  return new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(destino);
    response.data.pipe(writer);
    writer.on('finish', () => {
      console.log(`PDF salvo em: ${destino}`);
      resolve(destino);
    });
    writer.on('error', reject);
  });
}

async function authenticateSignNow() {
  const response = await axios.post('https://api.signnow.com/oauth2/token', SIGNNOW, {
    headers: { 'Content-Type': 'application/json', 'Authorization' : `Basic ${SIGNNOW.basicToken}`  }
  });
  console.log('Token SignNow obtido.');
  return response.data.access_token;
}

async function uploadDocumentToSignNow(token, filePath) {
  const form = new FormData();
  form.append('file', fs.createReadStream(filePath));

  const response = await axios.post('https://api.signnow.com/document', form, {
    headers: {
      Authorization: `Bearer ${token}`,
      ...form.getHeaders(),
    }
  });

  console.log('Documento enviado para SignNow.');
  return response.data.id;
}

async function getDocumentInfo(token, documentId) {
  const url = `https://api.signnow.com/document/${documentId}`;
  const response = await axios.get(url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  console.log('Informações do documento obtidas.');
  return response.data;
}
async function editDocumentFields(token, documentId) {
  const url = `https://api.signnow.com/document/${documentId}`;

  const payload = {
    fields: [
      {
        type: 'signature',
        required: true,
        role: INVITE_SETTINGS.role,
        x: 300,
        y: 700,
        height: 25,
        width: 100,
        page_number: 1
      }
    ]
  };

  const response = await axios.put(url, payload, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });

  console.log('Campo de assinatura adicionado ao documento.');
  return response.data;
}
async function sendInviteToSign(token, documentId, role_id, email, nome) {
  const url = `https://api.signnow.com/document/${documentId}/invite`;

  const payload = {
    document_id: documentId,
    from: INVITE_SETTINGS.from,
    to: [
      {
        email: email,
        role_id: role_id,
        role: INVITE_SETTINGS.role,
        order: 1,
        prefill_signature_name: nome,
        subject: INVITE_SETTINGS.subject,
        message: INVITE_SETTINGS.message
      }
    ]
  };
  
  const response = await axios.post(url, payload, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    }
  });

  console.log('Convite para assinatura enviado.');
  return response.data;
}
app.get('/', (req,res) => {
    return res.json("OK")
})
app.post('/enviar-para-assinar', async (req, res) => {
  const { fileId, email, nomeArquivo, nome } = req.body;

  if (!fileId || !email) {
    return res.status(400).json({ error: 'Informe fileId e email' });
  }
  let localFile;
  try {
    localFile = await downloadFromGoogleDrive(fileId, DOWNLOAD_FOLDER, `${nomeArquivo}.pdf`);

    const token = await authenticateSignNow();
    const documentId = await uploadDocumentToSignNow(token, localFile);

    await editDocumentFields(token, documentId, 'Signer 1');

    const documentInfo = await getDocumentInfo(token, documentId);
    const roleId = documentInfo.roles[0].unique_id;

    const invite = await sendInviteToSign(token, documentId, roleId, email, nome);

    return res.json({
      message: 'Documento enviado para assinatura com sucesso',
      documentId,
      invite
    });

  } catch (error) {
    console.error('Erro:', error.response?.data || error.message);
    return res.status(500).json({ error: error.response?.data || error.message });
  } finally {
    if (localFile) {
      fs.unlink(localFile, (err) => {
        if (err) {
          console.error('Erro ao apagar o arquivo local:', err);
        } else {
          console.log('Arquivo local apagado com sucesso.');
        }
      });
    }
  }
});

// === INICIAR SERVIDOR ===
app.listen(3000, () => {
  console.log('API rodando em http://localhost:3000');
});
