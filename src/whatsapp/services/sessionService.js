const prisma = require('../../../config/prisma');
const { formatMenuText } = require('./menuService');

async function getOrCreateSession(senderPhoneNumber, tenantId, welcomeNodeId) {
    let session = await prisma.botSession.findUnique({ where: { id: senderPhoneNumber } });
    
    if (!session || session.tenantId !== tenantId) {
        session = await prisma.botSession.upsert({
            where: { id: senderPhoneNumber },
            update: { currentNodeId: welcomeNodeId, tenantId: tenantId },
            create: { id: senderPhoneNumber, currentNodeId: welcomeNodeId, tenantId: tenantId }
        });
    }
    return session;
}

async function handleGreetings(sock, rawJid, session, welcomeNode, incomingText) {
    const greetings = ['halo', 'hai', 'p', 'tes', 'test', 'selamat siang', 'selamat pagi', 'selamat sore', 'selamat malam', 'assalamualaikum'];
    
    if (greetings.includes(incomingText.toLowerCase()) && session.currentNodeId === welcomeNode.id) {
        const currentHour = new Date().getHours();
        let timeGreeting = "hari";
        if (currentHour >= 4 && currentHour < 10) timeGreeting = "pagi";
        else if (currentHour >= 10 && currentHour < 15) timeGreeting = "siang";
        else if (currentHour >= 15 && currentHour < 18) timeGreeting = "sore";
        else timeGreeting = "malam";

        await prisma.botSession.update({
            where: { id: session.id },
            data: { currentNodeId: welcomeNode.id }
        });

        const greetingResponse = `Halo! Selamat ${timeGreeting}. 😊\n\n${formatMenuText(welcomeNode)}`;
        await sock.sendMessage(rawJid, { text: greetingResponse });
        return true; // Sapaan berhasil ditangani
    }
    return false;
}

module.exports = { getOrCreateSession, handleGreetings };