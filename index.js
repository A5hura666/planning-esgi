const puppeteer = require('puppeteer');
const fs = require('fs');
const ics = require('ics');
const {writeFileSync} = require("fs");
const { parse, format } = require('date-fns');
const {fr} = require('date-fns/locale');

const args = process.argv.slice(2);
if (args.length < 2) {
    console.error('Usage: node script.js <username> <password>');
    process.exit(1);
}
const [username, password] = args;

(async () => {
    const browser = await puppeteer.launch({
        headless: false,
    });
    const page = await browser.newPage();
    await page.goto('https://ges-cas.kordis.fr/login');
    await connexion(page, username, password);

    const mygesPage = await browser.newPage();
    await mygesPage.goto('https://www.myges.fr/#/');
    await delay(2000);

    await mygesPage.waitForSelector('a.btn-lg.btn.btn-blue[href="open-session"]', { visible: true });
    await mygesPage.click('a.btn-lg.btn.btn-blue[href="open-session"]');
    console.log("Lien 'Ouvrir une session' cliqué avec succès");
    await delay(1000);

    await mygesPage.waitForSelector('a[href="/student/planning-calendar"]');
    await mygesPage.click('a[href="/student/planning-calendar"]');
    console.log("Lien 'Plannings' cliqué avec succès");
    await delay(1000);

    const events = [];
    const eventsElements = await mygesPage.$$('.fc-event');

    let currentDay = 0;
    let previousLeft = -1;

    for (let event of eventsElements) {
        const eventTime = await event.$eval('.fc-event-time', el => el.innerText);
        // const eventTitle = await event.$eval('.fc-event-title', el => el.innerText);
        const eventLeft = parseInt(await event.evaluate(el => el.style.left));

        if (eventLeft !== previousLeft) {
            currentDay++;
        }

        await event.click();

        await mygesPage.waitForSelector('.ui-dialog.ui-overlay-visible', { visible: true });

        const additionalInfo = await mygesPage.evaluate(() => {
            const modal = document.querySelector('.ui-dialog.ui-overlay-visible');
            if (!modal) return {};

            return {
                duration: modal.querySelector('#duration')?.innerText,
                matiere: modal.querySelector('#matiere')?.innerText,
                intervenant: modal.querySelector('#intervenant')?.innerText,
                salle: modal.querySelector('#salle')?.innerText,
                type: modal.querySelector('#type')?.innerText,
                modality: modal.querySelector('#modality')?.innerText,
                commentaire: modal.querySelector('#commentaire')?.innerText,
                title: modal.querySelector('#matiere')?.innerText,
            };
        });

        events.push({
            day: currentDay,
            time: eventTime,
            left: eventLeft,
            ...additionalInfo,
        });

        previousLeft = eventLeft;

        await mygesPage.click('.ui-dialog-titlebar-close');

        await delay(1500);
    }

    const weekLabel = await getWeekDate(mygesPage);
    await createICS(events, weekLabel);
    await browser.close();
})();

async function connexion(page, username, password) {
    await page.type('#username', username);
    await page.type('#password', password);
    await page.click('input.input_submit');
    await page.waitForNavigation();
}

async function getWeekDate(mygesPage) {
    const weekLabel = await mygesPage.$eval('#calendar\\:currentWeek', label => label.innerText);
    return weekLabel;
}

function parseStartDate(weekLabel) {
    const parts = weekLabel.split(' - ');

    if (parts.length !== 2) {
        throw new Error('Le format de la chaîne est incorrect, il doit contenir " - " pour séparer les dates.');
    }

    const startDateStr = parts[0];
    const yearStr = weekLabel.split(' ').pop(); // Récupérer l'année depuis la fin de la chaîne

    if (!startDateStr || !yearStr) {
        throw new Error('La date de début ou l\'année est manquante.');
    }

    const startDateFullStr = `${startDateStr.trim()} ${yearStr.trim()}`;

    const formatStr = 'd MMMM yyyy';

    const startDate = parse(startDateFullStr, formatStr, new Date(), { locale: fr });

    return startDate;
}

async function createICS(events, weekLabel) {
    // Récupérer la date de début de la semaine à partir de weekLabel
    const startDate = parseStartDate(weekLabel);

    const icsEvents = [];

    // Parcourir tous les événements pour créer les objets ICS
    for (const event of events) {
        const [startHour, startMinute] = event.time.split(' - ')[0].split(':');
        const [endHour, endMinute] = event.time.split(' - ')[1].split(':');

        // Créer un objet Date pour le début de l'événement
        const eventStartDate = new Date(startDate);
        eventStartDate.setDate(startDate.getDate() + event.day - 1); // Ajuster en fonction du jour de la semaine
        eventStartDate.setHours(startHour, startMinute, 0, 0); // Définir l'heure de début

        // Créer un objet Date pour la fin de l'événement
        const eventEndDate = new Date(eventStartDate);
        eventEndDate.setHours(endHour, endMinute, 0, 0); // Définir l'heure de fin

        // Assurez-vous que les dates sont valides
        if (isNaN(eventStartDate.getTime()) || isNaN(eventEndDate.getTime())) {
            console.error(`Erreur de date pour l'événement: ${event.title}`);
            continue; // Sauter cet événement si les dates ne sont pas valides
        }

        // Calculer la durée de l'événement
        const durationHours = eventEndDate.getHours() - eventStartDate.getHours();
        const durationMinutes = eventEndDate.getMinutes() - eventStartDate.getMinutes();

        const start = [
            eventStartDate.getFullYear(),
            eventStartDate.getMonth() + 1,
            eventStartDate.getDate(),
            eventStartDate.getHours(),
            eventStartDate.getMinutes(),
        ];

        const end = [
            eventEndDate.getFullYear(),
            eventEndDate.getMonth() + 1,
            eventEndDate.getDate(),
            eventEndDate.getHours(),
            eventEndDate.getMinutes(),
        ];
        const icsEvent = {
            start: start,
            end: end,
            // duration: { hours: durationHours, minutes: durationMinutes },
            title: event.title,
            description: `${event.intervenant}\n${event.type}\n${event.modality}`,
            location: event.salle || 'Non spécifié',
            status: 'CONFIRMED',
            busyStatus: 'BUSY'
        };

        icsEvents.push(icsEvent);
    }

    ics.createEvents(icsEvents, (error, value) => {
        if (error) {
            console.log('Erreur lors de la création du fichier ICS:', error);
        } else {
            writeFileSync('events.ics', value); // Sauvegarder le fichier ICS
            console.log('Fichier .ics créé avec succès');
        }
    });
}

async function delay(time) {
    return new Promise(resolve => setTimeout(resolve, time));
}