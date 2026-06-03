const Tesseract = require('tesseract.js');
const path = require('path');

// Aponta para a imagem que está na mesma pasta
const imagePath = path.join(__dirname, 'notaFiscal.jpeg');

async function testarExtracao() {
  console.log('Iniciando a leitura da nota com Tesseract... (A primeira vez pode demorar um pouco para baixar o idioma PT-BR)');

  try {
    // 1. Roda o OCR na imagem local
    const { data: { text } } = await Tesseract.recognize(
      imagePath,
      'por', // Idioma português
      { logger: m => console.log(`Progresso OCR: ${m.status} - ${Math.round(m.progress * 100)}%`) }
    );

    console.log('\n--- 📝 TEXTO BRUTO EXTRAÍDO PELO OCR ---\n');
    console.log(text);
    console.log('\n----------------------------------------\n');

    // 2. Passa o texto bruto para a nossa função de garimpar os dados
    const extractedData = parseReceiptText(text);

    console.log('✅ JSON FINAL AGRUPADO PARA O FRONTEND:\n');
    console.log(JSON.stringify(extractedData, null, 2));

  } catch (error) {
    console.error('❌ Erro no processamento da nota:', error);
  }
}

// ==========================================
// FUNÇÃO PARA GARIMPAR E AGRUPAR OS DADOS (VERSÃO BLINDADA)
// ==========================================
function parseReceiptText(text) {
  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  const itemsMap = new Map();
  let totalPurchase = 0;

  // A MÁGICA ESTÁ AQUI: Regex super tolerante a erros do OCR
  // Aceita "IUN" no lugar de "1UN", aceita travessão no lugar de espaço, aceita ponto no lugar de vírgula, e ignora lixo no final da linha.
  const pricePattern = /(?:(\d*)\s*(UN|IUN|KG|G|L)[\s,\.\—\-]*)?(\d+[\.,]\d{2})[\s\.\—\-]+(\d+[\.,]\d{2})\s*.*?$/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(pricePattern);

    if (match) {
      // Se não achar o número da quantidade ou o OCR ler "IUN", forçamos para 1
      let qty = parseInt(match[1], 10);
      if (isNaN(qty)) qty = 1;

      const unitPrice = parseFloat(match[3].replace(',', '.'));
      const totalPrice = parseFloat(match[4].replace(',', '.'));

      // Arranca a parte do preço da linha para sobrar o nome
      let itemName = line.replace(match[0], '').trim();

      // Se o nome ficou vazio (quebra de linha do OCR), pega a linha de cima
      if (itemName.length < 5 && i > 0) {
        itemName = lines[i - 1];
      }

      // FAXINA NO NOME: Pega a partir da primeira palavra com letras maiúsculas 
      // Isso arranca códigos bizarros do começo tipo "doi 789BOBO6402272"
      const nameMatch = itemName.match(/[A-Z]{2,}.*$/);
      if (nameMatch) {
        itemName = nameMatch[0];
      }

      // Arranca sujeiras do final tipo " À h" ou " k"
      itemName = itemName.replace(/\s+[^A-Z0-9]{1,2}$/i, '').trim();

      // Padroniza os acentos para agrupar certo (ITALAC vs ÍTALAC)
      let normalizedName = itemName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();

      // Chave de agrupamento: usa as 3 primeiras palavras pra garantir que junta os mesmos itens
      let groupKey = normalizedName.split(' ').slice(0, 3).join(' ');

      if (itemsMap.has(groupKey)) {
        // Já existe? Soma a quantidade e o valor
        const existingItem = itemsMap.get(groupKey);
        existingItem.quantity += qty;
        existingItem.total_price += totalPrice;
      } else {
        // Novo? Cadastra no Map
        itemsMap.set(groupKey, {
          name: normalizedName,
          quantity: qty,
          unit_price: unitPrice,
          total_price: totalPrice
        });
      }
    }

    // Caça o valor total pago
    if (line.toUpperCase().includes('PAGAR R$') || line.toUpperCase().includes('VALOR PAGO')) {
       const totalMatch = line.match(/(\d+,\d{2})/);
       if (totalMatch) {
           totalPurchase = parseFloat(totalMatch[1].replace(',', '.'));
       }
    }
  }

  return {
    items: Array.from(itemsMap.values()),
    total_purchase: totalPurchase
  };
}

// Executa o teste
testarExtracao();