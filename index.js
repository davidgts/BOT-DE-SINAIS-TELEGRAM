/*--------------------------------------------------------------------*/
/* Sistema de envio de sinais de cassino no o telegram  - Auto PILOT  */
/*--------------------------------------------------------------------*/
//                        by david machado                            //
/*--------------------------------------------------------------------*/
const TelegramBot = require('node-telegram-bot-api');
const {Sequelize,DataTypes} = require('sequelize');
const nodeSchedule = require('node-schedule')
const fs = require('fs')
const date = require('dayjs')

// Carrega as Credenciais para Autenticação nas plataformas
require('dotenv').config()

//////////////////////////////////////////////////////////////////////
const token =  process.env.tokenGratis 

const chatId = process.env.CHANNEL_GRATIS // Id do chat Grupo Gratis

const sequelize = new Sequelize(
    
    process.env.DATABASE_BASE,
    process.env.DATABASE_USER,
    process.env.DATABASE_PASSWORD,
    {
      host: process.env.DATABASE_HOST,
      dialect: 'mysql',
      logging: false
    }
);

sequelize.authenticate().then(() => {
console.log('Connection with database has been established successfully.');
}).catch((error) => {
console.error('Unable to connect to the database: ', error);
});
 
//DEFININDO OS SCHEMAS
const tb_resultados = sequelize.define("tb_resultados", {
    id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true
    },
    multiplicador: {
      type: DataTypes.STRING,
      allowNull: false
    },
    alto_baixo: {
      type: DataTypes.BOOLEAN,
      allowNull: false
    },
    data_entrada: {
        type: DataTypes.STRING,
        allowNull: false
    },
    horario_entrada:{
        type: DataTypes.STRING,
        allowNull: false
    }
  
});


const bot = new TelegramBot(token, {polling: true});


bot.on('polling_error',async(error)=>{
   
    console.log ("Mensagem capturada erro Telegram: "+error.message)
    if(bot.isPolling()){
        console.log('Conectado ao telegram')
    
        await bot.stopPolling()
      }

      await bot.startPolling({restart:true})
});

//define a quantidade de sinais por horario
const QTDSINAIS = 1;

//Define quantas rodadas que aguarda até ser liberado para analisar outro green 
const RODADAS_REDALERT = 6;

// Lista de elementos que serão atualizados no momento
let analiser1= [];
let analiser2= [];

// Serviço de leitura da base de dados
let findElementService = null;

// Quantidade de greens que já foi feito
let greenStatus =0;
let rodadas = 0;

// Ativo ou não o alerta de red
let redAlert = false;

// Identifica quais são os sinais ativos no momento
let sinalAtivo = {
    sinal1:true,
    sinal2:false,
}

// Recebe o objeto do telegram referente a mensagem de sinal 1
let sinalMessage
let betMessage

// Recebe o objeto do telegram referente a mensagem de sinal 2
let sinalMessage2
let betMessage2

// Indica se o bot está iniciado ou não
let isStart = true


bot.onText(/\/start/,async(msg,match)=>{
    if(!isStart){
        console.log('Bot Iniciado...')
        isStart = true; 
        console.log('Grupo Gratuito: '+ chatId)
        bot.sendMessage(msg.chat.id,'🤖 BOT ESTÁ LIGADO !🟢') 
        bot.sendMessage(chatId,'🤖 BOT ESTÁ LIGADO !🟢')
        let sns = quaisSinaisAtivos(sinalAtivo)
        bot.sendMessage(msg.chat.id,sns,{parse_mode:'HTML'})
       capturaElementos() 
    }else{
        
        bot.sendMessage(msg.chat.id,'🤖 BOT JÁ ESTÁ LIGADO !🟢')  
    }
    
})

bot.onText(/\/stats/,async(msg,match)=>{
   
    let m = await botStats()
    let enviado = await bot.sendMessage(chatId,m,{parse_mode:'HTML'})
    bot.pinChatMessage(chatId,enviado.message_id)
       
   
    
})

// ultimo resultado lido da base(Utilizado na função capturaElementos() )
let ultimo_resultado;
async function capturaElementos(){

    try {
        findElementService  =  setInterval (async ()  => {
            let atual = await findLastElement()
            if(ultimo_resultado != atual){
                ultimo_resultado = atual
                senderSignal(atual)
            }
            
         }, 300);
    } catch (error) {
        console.log('ERRO CAPTURA ELEMENTOS: '+error)
        capturaElementos()
    }
   
}

//Rotina pra iniciar o bot
nodeSchedule.scheduleJob('0 00 12 * * ?', async() => { 
    if(!isStart){
        console.log('Inicio das 12:00h')
        bot.sendMessage(chatId,'🤖 BOT ESTÁ LIGADO !🟢') 
        capturaElementos() 
    }
   
});


async function senderSignal(valor){
    let tester = valor;
    console.log(tester)
   
    if(greenStatus>=QTDSINAIS){
        console.log('Stop Bot....: '+greenStatus)
        greenStatus=0;
        stopBot()
    }

    if (redAlert && rodadas < RODADAS_REDALERT){
        console.log('RED ALERT ATIVO : '+rodadas)
        rodadas=rodadas+1
    }else if (redAlert && rodadas == RODADAS_REDALERT){
        console.log('RED ALERT DESLIGADO!')
        redAlert=false;
        rodadas=0;
    }

    if(sinalAtivo.sinal1 && !redAlert){
        analiser1.push(tester)
        sinal1()
    }

    if(sinalAtivo.sinal2 && !redAlert){
        analiser2.push(tester)
        sinal2()
    }
    
//[PADRÃO SINAL 2]
/*
1° Baixo
2° Baixo -> Analisa
3° Baixo -> Entrada
4° Alto -> Green ou Gale
5° Alto -> Green ou Gale
6° Alto -> Green ou Red
*/

   async function sinal1(){
        if(analiser1.length === 2){
            if((analiser1[0]  < 2.00) &&  (analiser1[1]<2.00)){//BAIXO
                console.log('Analisando Sinal 1...')
                console.log(analiser1)
                sinalMessage = await telegramsendAnalise()
                return true;  
            }else{
                console.log('---------------------------------------')
                console.log('Padrão 1 não encontrado')
                console.log('---------------------------------------')
                analiser1 = analiserClear(analiser1,1) 
                return true
            }
        }else if(analiser1.length === 3){
            if(analiser1[2] < 2.00){//BAIXO
                console.log('Entrar aposta: Sair em 1.50x')                        
                await bot.deleteMessage(chatId,sinalMessage.message_id)
                betMessage = await telegramsendBet (analiser1[analiser1.length-1],'1.50')
                console.log(analiser1)
                return true;  
            }else{
                await bot.deleteMessage(chatId,sinalMessage.message_id)
                console.log('---------------------------------------')
                console.log('Padrão 1 não encontrado')
                console.log('---------------------------------------')
                analiser1= analiserClear(analiser1,analiser1.length-1)
                return true;      
            }
        }else if(analiser1.length === 4){
           if(analiser1[3] > 1.50){
                await bot.deleteMessage(chatId,betMessage.message_id)
                await telegrambetend('1.50X')
                await telegramsendGreen(analiser1[analiser1.length-1]+'X','Sinal 1') 
                console.log("Green 1 (SINAL1) ....")
                analiser1= analiserClear(analiser1,analiser1.length-1)   
                console.log(analiser1)
                return true;
           }else{
                console.log('GALE 1 (SINAL1)')
                return true;
           }
        }else if(analiser1.length === 5){
            if(analiser1[analiser1.length-1] > 1.50){
                 await bot.deleteMessage(chatId,betMessage.message_id)
                 await telegrambetend('1.50X')
                 await telegramsendGreen([analiser1[analiser1.length-2]+'X',analiser1[analiser1.length-1]+'X'],'Sinal 1') 
                 console.log("Green 2(SINAL1)....")
                 analiser1 = analiserClear(analiser1, analiser1.length-1)   
                 console.log(analiser1)
                 return true;
            }else{
                 console.log('GALE 2 (SINAL1)')
                 return true;
            }
        }if(analiser1.length === 6){
            let resultadoFinal = [analiser1[analiser1.length-3]+'X',analiser1[analiser1.length-2]+'X',analiser1[analiser1.length-1]+'X']
            if(analiser1[analiser1.length-1] > 1.50){
                await bot.deleteMessage(chatId,betMessage.message_id)
                await telegrambetend('1.50X')
                await telegramsendGreen(resultadoFinal,'Sinal 1') 
                console.log("Green 3 (SINAL1) ....")
                analiser1= analiserClear(analiser1,analiser1.length-1) 
                console.log(analiser1)
                return true;
           }else{
                await bot.deleteMessage(chatId,betMessage.message_id)
                await telegrambetend('1.50X')
                await telegramsendRed(resultadoFinal,'Sinal 1')  
                console.log("RED ...")
                redAlert = true;
                analiser1 = analiserClear(analiser1,analiser1.length) 
                console.log(analiser1)
                return true;
            }
          
        }
   }

//[PADRÃO SINAL 2]
/*      
 1° Alto
 2° Baixo
 3° Baixo
 4° Alto
 5° Baixo <- Analisa
 6° Baixo <- Entrada
 7° Alto <- Green ou Gale
 8° Alto <- Green ou Gale
 9° Alto <- Green ou Red
*/
   async function sinal2(){
    if(analiser2.length === 5){
                 //Alto                      baixo               baixo                   alto                    baixo
        if((analiser2[0] > 2.00) && (analiser2[1]<2.00) && (analiser2[2]<2.00) && (analiser2[3]>2.00) && (analiser2[4]<2.00) && (analiser1.length<3) ){ //Padrão para analise
            console.log('Analisando Sinal 2...')
            console.log(analiser2)
            sinalMessage2 = await telegramsendAnalise()
            analiser1=[]
            sinalAtivo.sinal1=false
            return true;  
        }else{
            console.log('---------------------------------------')
            console.log('Padrão 2 não encontrado')
            console.log('---------------------------------------')
            analiser2 = analiserClear(analiser2,2) 
            sinalAtivo.sinal1=true
            return true
        }
    }else if(analiser2.length === 6){
        if(analiser2[analiser2.length-1] < 2.00){//Baixo
            console.log('Entrar aposta: Sair em 2.00x')                        
            await bot.deleteMessage(chatId,sinalMessage2.message_id)
            betMessage2 = await telegramsendBet (analiser2[analiser2.length-1],'2.00')
            console.log(analiser2)
            return true;  
        }else{
            await bot.deleteMessage(chatId,sinalMessage2.message_id)
            console.log('---------------------------------------')
            console.log('Padrão 2 não encontrado')
            console.log('---------------------------------------')
            analiser2= analiserClear(analiser2, 3)
            sinalAtivo.sinal1=true
            return true;      
        }
    }else if(analiser2.length === 7){
       if(analiser2[analiser2.length-1] > 2.00){ // Alto
            await bot.deleteMessage(chatId,betMessage2.message_id)
            await telegrambetend('2.00X')
            await telegramsendGreen(analiser2[analiser2.length-1]+'X','Sinal 2') 
            console.log("Green (SINAL2) 1 ....")
            analiser2= analiserClear(analiser2,4)   
            sinalAtivo.sinal1=true
            console.log(analiser2)
            return true;
       }else{
            console.log('GALE 1 (SINAL2)')
            return true;
       }
    }else if(analiser2.length === 8){
        if(analiser2[analiser2.length-1] > 2.00){
             await bot.deleteMessage(chatId,betMessage2.message_id)
             await telegrambetend('2.00X')
             await telegramsendGreen([analiser2[analiser2.length-2]+'X',analiser2[analiser2.length-1]+'X'],'Sinal 2') 
             console.log("Green 2 (SINAL2)....")
             analiser2 = analiserClear(analiser2, 5)   
             console.log(analiser2)
             sinalAtivo.sinal1=true
             return true;
        }else{
             console.log('GALE 2 (SINAL2)')
             return true;
        }
    }if(analiser2.length === 9){
        sinalAtivo.sinal1=true
        let resultadoFinal2 = [analiser2[analiser2.length-3]+'X',analiser2[analiser2.length-2]+'X',analiser2[analiser2.length-1]+'X']
        if(analiser2[analiser2.length-1] > 2.00){
            await bot.deleteMessage(chatId,betMessage2.message_id)
            await telegrambetend('2.00X')
            await telegramsendGreen(resultadoFinal2,'Sinal 2') 
            console.log("Green 3 (SINAL2)....")
            analiser2= analiserClear(analiser2,6) 
            console.log(analiser2)
            return true;
       }else{
            await bot.deleteMessage(chatId,betMessage2.message_id)
            await telegrambetend('2.00X')
            await telegramsendRed(resultadoFinal2,'Sinal 2')  
            console.log("RED (SINAL2)...")
            redAlert = true;
            analiser2 = analiserClear(analiser2,6) 
            console.log(analiser2)
            return true;
        }
      
    }
   }

}

//Para o bot
function stopBot(){

      
    bot.sendMessage(chatId,'🤖 BOT FOI PARADO 🔴')
    bot.sendMessage(chatId,'🤖 ATIVO APENAS NO GRUPO VIP ATIVO LÁ TEM MAIS DE 150 SINAIS POR DIA🟩')

    let mensagem = `🤖 PRÓXIMO SINAL SÓ AMANHA AS 12H
🚨Horário de Brasília🚨
CASO QUEIRA OBETER O GRUPO VITALÍCIO COM +200 SINAIS DIÁRIOS, GRUPO VIP🚨⬇️
https://autopilot.kpages.online/autopilot
Cupom: ALUNOS`
    bot.sendMessage(chatId,mensagem)    

    clearInterval(findElementService)
    isStart= false
    analiser1= []
}    

// Acessa a base de dados para consultar o ultimo elemento adicionado
async function findLastElement () {
    
  let value =   await sequelize.sync().then(() => {
    let retorno =  tb_resultados.findOne({ limit: 1, order: [['createdAt', 'DESC']]}).then(leitura=>{ return leitura.dataValues.multiplicador;});
        return retorno
    })
   
    return value;
}

// Monta a mensagem dos sinais ativos
function quaisSinaisAtivos(sinalAtivo){
    let msg
    let sts1
    let sts2
    let sts3
    let sts4

    if(sinalAtivo.sinal1){
        sts1 = '🟢'
    }else{
        sts1 = '🔴'
    }
    if(sinalAtivo.sinal2){
        sts2 = '🟢'
    }else{
        sts2 = '🔴'
    }
    if(sinalAtivo.sinal3){
        sts3 = '🟢'
    }else{
        sts3 = '🔴'
    }
    if(sinalAtivo.sinal4){
        sts4 = '🟢'
    }else{
        sts4 = '🔴'
    }
    msg = `<b>SINAIS ATIVOS</b>
SINAL 1 : `+sts1+`
SINAL 2 : `+sts2+`
SINAL 3 : `+sts3+`
SINAL 4 : `+sts4

    return  msg

}

//Envia a mensagem de analise de aposta para o telgram
async function telegramsendAnalise(){
    let msg = `🍀<b>AUTO PILOT - ROBÔ</b>🍀
🚨ATENÇÃO🚨
🤞POSSÍVEL ENTRADA✈️
Aguardem confirmação❗️
LINK🚨➡️ : <a href=\'https://br.betano.com/casino/games/aviator/3337/\'>🔗LINK</a>`;

    let message = await bot.sendMessage(chatId,msg,{parse_mode:'HTML',disable_web_page_preview:true})

    return message
}

//Envia a mensagem de Entrada da aposta dos sinais para o telgram
async function telegramsendBet(entrada,saida){
    let entrarapos = entrada+'X'
    let stop = saida+'X'
    let msg = `🍀<b>Auto Pilot - Robô</b>🍀
🚨ENTRADA CONFIRMADA🚨
Entrar após:`+entrarapos+`
PARA EM :`+stop+`X
Caso não de na primeira utilizar 
Gale✅✅✅
LINK🚨➡️ : <a href=\'https://br.betano.com/casino/games/aviator/3337/\'> <b>(AVIATOR) LINK🚨</b></a>
    `
    let message = await bot.sendMessage(chatId,msg,{parse_mode:'HTML',disable_web_page_preview:true})

    return message
}

//Envia a mensagem de Green para o telgram
async function telegramsendGreen(v,sts){  
    greenStatus=greenStatus+1;
    let rawdata = fs.readFileSync('./json/botGratisResultados.json');
    let result = JSON.parse(rawdata);

    let statMomentanea = {
        result: true,
        data : new date().format("DD/MM/YY"),
        hora : new date().format("HH:mm"),
        sinal: sts,
        sequencia: v.length
    }
   
    result.push(statMomentanea)
    gravaJson(result)

    let msg = `🍀<b>Auto Pilot - Robô</b>🍀
GREEN🤑🤑🤑
`+v+`✅✅
Bateu a meta? Saia do mercado
E poste no Instagram e marque nossa página➡️ <a href=\'https://www.instagram.com/bot.autopilot/\'> <b>@bot.autopilot</b></a>`
    
  await bot.sendMessage(chatId,msg,{parse_mode:'HTML',disable_web_page_preview:true})

   

}

//Envia a mensagem de Red para o telgram
async function telegramsendRed(v,sts){
    let rawdata = fs.readFileSync('./json/botGratisResultados.json');
    let result = JSON.parse(rawdata);

    let statMomentanea = {
        result: false,
        data : new date().format("DD/MM/YY"),
        hora : new date().format("HH:mm"),
        sinal: sts,
        sequencia: v.length
    }
   
    result.push(statMomentanea)
    
    gravaJson(result)   
 
     let msg = `🍀<b>Auto Pilot - Robô</b>🍀
 RED 😤😤😤
 `+v+`🔴🔴 
 Não ir além do red, tenha calma com calma vamos longe❗️
 Volte mais tarde✅`
     bot.sendMessage(chatId,msg,{parse_mode:'HTML',disable_web_page_preview:true})     
}

//Envia a mensagem de final da aposta para o telgram
async function telegrambetend(aposta){
    let msg = `🤖<b>Entrada finalizada</b>🤖
    Estratégia: Pular fora em`+aposta
    await bot.sendMessage(chatId,msg,{parse_mode:'HTML'})

} 

//Grava as informações de estatisticas do bot
async function gravaJson(result){
    fs.writeFileSync("./json/botGratisResultados.json", JSON.stringify(result), err => {
        // Checking for errors
        if (err) throw err;        
        console.log("Done writing"); // Success
    });
}

//Cria as informações de estatisticas do bot
async function botStats(){  
 
    let rawdata = fs.readFileSync('./json/botGratisResultados.json');
    let result = JSON.parse(rawdata);
    let now = new date()
    let total = 0;
    let greens = 0;
    let reds = 0;
    let porcentagem = 0;

    result.forEach(object =>{
        if(object.data === new date().format("DD/MM/YY")){
            if(object.result){
                greens = greens + 1;
            }else{
                reds = reds +1;
            }
        }      
    });

    
    total = reds+greens;
    porcentagem  = (greens*100)/total
    let msg = `🤖<b>Estatisticas do Bot</b>🤖
    `+
now.format("DD/MM")+`-`+now.format("HH:mm")+` 
TOTAL DE JOGADAS : `+total+`
RESULTADOS: `+greens+` GREEN✅ x `+reds+` RED🔴
PORCENTAGEM DE ACERTO: `+porcentagem.toFixed(2)+`%`

   return msg
} 

//Remove um numero X de elementos das primeiras posições da fila
function analiserClear(array,pos){
   
    for(let i=0; i<pos;i++){
        array.splice(0,1)
    }   
    return array
}