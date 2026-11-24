/*
 * Studio Pixel — Manager
 * sauvegarde.js : sauvegardes automatiques.
 *
 * Deux mécanismes, qui fonctionnent ensemble :
 *
 * 1. Copies de secours dans le navigateur (tous les navigateurs).
 *    Une copie par jour, les 14 derniers jours sont gardés. Elles permettent
 *    de revenir en arrière après une erreur, mais restent sur cet ordinateur.
 *
 * 2. Sauvegarde automatique dans un dossier (Chrome et Edge uniquement).
 *    La directrice choisit une fois un dossier, par exemple le dossier
 *    01_Pilotage du Drive synchronisé par « Google Drive pour ordinateur ».
 *    Après chaque modification (30 secondes plus tard), le Manager y écrit :
 *      - studio-pixel-manager-auto.json : toujours la version la plus récente ;
 *      - studio-pixel-manager-AAAA-MM-JJ.json : une copie par jour.
 *    Google Drive pour ordinateur envoie ensuite ces fichiers sur le Drive.
 *    Safari ne permet pas à une page d'écrire dans un dossier : ce mode n'y
 *    est pas proposé.
 *
 * Aucune donnée ne part sur Internet depuis ce fichier.
 */
(function (racine) {
  'use strict';

  var NOM_BASE = 'studioPixelManager';
  var CLE_META = 'studioPixelManager.v1.sauvegarde';
  var NB_COPIES = 14;
  var DELAI_MS = 30 * 1000;            // attente après une modification
  var PERIODE_MS = 10 * 60 * 1000;     // vérification régulière
  var RAPPEL_JOURS = 7;                // rappel si aucune sauvegarde hors navigateur

  var fournisseur = null;   // fonction qui renvoie le texte JSON à sauvegarder
  var surChangement = function () {};
  var minuterie = null;
  var enAttente = false;
  var dossier = null;       // poignée du dossier choisi (Chrome / Edge)
  var permission = 'aucun'; // 'non_supporte' | 'aucun' | 'a_reautoriser' | 'actif'
  var derniereErreur = '';

  function jour(date) {
    var d = date || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // ---------------------------------------------------------------- Petites informations (localStorage)

  function lireMeta() {
    try { return JSON.parse(racine.localStorage.getItem(CLE_META)) || {}; } catch (e) { return {}; }
  }
  function ecrireMeta(changements) {
    var m = Object.assign(lireMeta(), changements);
    try { racine.localStorage.setItem(CLE_META, JSON.stringify(m)); } catch (e) { /* rien */ }
    return m;
  }

  // ---------------------------------------------------------------- Base IndexedDB (avec repli)

  var basePromesse = null;
  function ouvrirBase() {
    if (basePromesse) return basePromesse;
    basePromesse = new Promise(function (ok, ko) {
      if (!racine.indexedDB) { ko(new Error('IndexedDB indisponible')); return; }
      var req;
      try { req = racine.indexedDB.open(NOM_BASE, 1); } catch (e) { ko(e); return; }
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('copies')) db.createObjectStore('copies', { keyPath: 'jour' });
        if (!db.objectStoreNames.contains('reglages')) db.createObjectStore('reglages');
      };
      req.onsuccess = function () { ok(req.result); };
      req.onerror = function () { ko(req.error || new Error('IndexedDB refusé')); };
    });
    basePromesse.catch(function () { basePromesse = null; });
    return basePromesse;
  }

  function operation(nomMagasin, mode, action) {
    return ouvrirBase().then(function (db) {
      return new Promise(function (ok, ko) {
        var tx = db.transaction(nomMagasin, mode);
        var resultat;
        var req = action(tx.objectStore(nomMagasin));
        if (req) req.onsuccess = function () { resultat = req.result; };
        tx.oncomplete = function () { ok(resultat); };
        tx.onerror = function () { ko(tx.error); };
        tx.onabort = function () { ko(tx.error || new Error('Transaction annulée')); };
      });
    });
  }

  // Repli si IndexedDB n'est pas disponible (certains navigateurs en fichier local) :
  // les copies sont gardées dans localStorage, en moins grand nombre.
  var CLE_REPLI = 'studioPixelManager.v1.copies';
  function lireRepli() {
    try { return JSON.parse(racine.localStorage.getItem(CLE_REPLI)) || []; } catch (e) { return []; }
  }
  function ecrireRepli(liste) {
    try { racine.localStorage.setItem(CLE_REPLI, JSON.stringify(liste)); return true; } catch (e) { return false; }
  }

  // ---------------------------------------------------------------- Copies de secours

  function enregistrerCopie(texte) {
    var copie = { jour: jour(), date: new Date().toISOString(), taille: texte.length, texte: texte };
    return operation('copies', 'readwrite', function (s) { return s.put(copie); })
      .then(function () { return operation('copies', 'readonly', function (s) { return s.getAllKeys(); }); })
      .then(function (cles) {
        cles.sort();
        var trop = cles.slice(0, Math.max(0, cles.length - NB_COPIES));
        if (!trop.length) return;
        return operation('copies', 'readwrite', function (s) { trop.forEach(function (c) { s.delete(c); }); });
      })
      .catch(function () {
        // Repli : 5 copies maximum dans localStorage.
        var liste = lireRepli().filter(function (c) { return c.jour !== copie.jour; });
        liste.push(copie);
        liste.sort(function (a, b) { return a.jour < b.jour ? -1 : 1; });
        while (liste.length > 5) liste.shift();
        while (liste.length && !ecrireRepli(liste)) liste.shift();
      });
  }

  function listerCopies() {
    return operation('copies', 'readonly', function (s) { return s.getAll(); })
      .catch(function () { return lireRepli(); })
      .then(function (liste) {
        return (liste || []).map(function (c) { return { jour: c.jour, date: c.date, taille: c.taille }; })
          .sort(function (a, b) { return a.jour < b.jour ? 1 : -1; });
      });
  }

  function lireCopie(j) {
    return operation('copies', 'readonly', function (s) { return s.get(j); })
      .catch(function () { return lireRepli().filter(function (c) { return c.jour === j; })[0]; })
      .then(function (c) {
        if (!c) throw new Error('Copie introuvable.');
        return c.texte;
      });
  }

  // ---------------------------------------------------------------- Dossier choisi (Chrome / Edge)

  function dossierPossible() {
    return typeof racine.showDirectoryPicker === 'function';
  }

  function verifierPermission() {
    if (!dossierPossible()) { permission = 'non_supporte'; return Promise.resolve(permission); }
    if (!dossier) { permission = 'aucun'; return Promise.resolve(permission); }
    var demande = dossier.queryPermission ? dossier.queryPermission({ mode: 'readwrite' }) : Promise.resolve('granted');
    return demande.then(function (p) {
      permission = p === 'granted' ? 'actif' : 'a_reautoriser';
      return permission;
    }, function () { permission = 'a_reautoriser'; return permission; });
  }

  function chargerDossier() {
    if (!dossierPossible()) { permission = 'non_supporte'; return Promise.resolve(permission); }
    return operation('reglages', 'readonly', function (s) { return s.get('dossier'); })
      .then(function (h) { dossier = h || null; }, function () { dossier = null; })
      .then(verifierPermission);
  }

  function ecrireFichier(nom, texte) {
    return dossier.getFileHandle(nom, { create: true }).then(function (f) {
      return f.createWritable().then(function (w) {
        return Promise.resolve(w.write(texte)).then(function () { return w.close(); });
      });
    });
  }

  function ecrireDansDossier(texte) {
    if (permission !== 'actif' || !dossier) return Promise.resolve(false);
    return ecrireFichier('studio-pixel-manager-auto.json', texte)
      .then(function () { return ecrireFichier('studio-pixel-manager-' + jour() + '.json', texte); })
      .then(function () {
        derniereErreur = '';
        ecrireMeta({ dernierDossier: new Date().toISOString() });
        return true;
      }, function (e) {
        derniereErreur = (e && e.message) || 'écriture impossible';
        // Permission retirée entre-temps : on le signale, sans bloquer le reste.
        return verifierPermission().then(function () { return false; });
      });
  }

  // À appeler depuis un clic : ouvre la fenêtre de choix du dossier.
  function choisirDossier() {
    if (!dossierPossible()) return Promise.reject(new Error('Ce navigateur ne permet pas de choisir un dossier (utilisez Chrome ou Edge).'));
    return racine.showDirectoryPicker({ id: 'studio-pixel-manager', mode: 'readwrite' }).then(function (h) {
      dossier = h;
      return operation('reglages', 'readwrite', function (s) { return s.put(h, 'dossier'); }).catch(function () { /* mémorisation impossible : actif pour cette séance */ });
    }).then(function () {
      ecrireMeta({ nomDossier: dossier.name || '' });
      return verifierPermission();
    }).then(function () { return sauvegarderMaintenant(); });
  }

  // À appeler depuis un clic : redonne l'accès au dossier après un redémarrage du navigateur.
  function reautoriser() {
    if (!dossier || !dossier.requestPermission) return Promise.resolve(permission);
    return dossier.requestPermission({ mode: 'readwrite' }).then(function (p) {
      permission = p === 'granted' ? 'actif' : 'a_reautoriser';
      if (permission === 'actif') return sauvegarderMaintenant().then(function () { return permission; });
      surChangement();
      return permission;
    });
  }

  function arreterDossier() {
    dossier = null;
    permission = dossierPossible() ? 'aucun' : 'non_supporte';
    ecrireMeta({ nomDossier: '' });
    return operation('reglages', 'readwrite', function (s) { return s.delete('dossier'); })
      .catch(function () { /* rien */ })
      .then(function () { surChangement(); });
  }

  // ---------------------------------------------------------------- Déclenchement

  function sauvegarderMaintenant() {
    if (!fournisseur) return Promise.resolve();
    clearTimeout(minuterie);
    minuterie = null;
    enAttente = false;
    var texte = fournisseur();
    return Promise.all([enregistrerCopie(texte), ecrireDansDossier(texte)]).then(function () {
      ecrireMeta({ derniereCopie: new Date().toISOString() });
      surChangement();
    });
  }

  // Appelée après chaque modification : regroupe les changements rapprochés.
  function signalerModification() {
    enAttente = true;
    clearTimeout(minuterie);
    minuterie = setTimeout(sauvegarderMaintenant, DELAI_MS);
  }

  function demarrer(options) {
    fournisseur = options.fournisseur;
    surChangement = options.surChangement || surChangement;
    // Vérification régulière, et dernière chance quand on quitte la page.
    setInterval(function () { if (enAttente) sauvegarderMaintenant(); }, PERIODE_MS);
    racine.addEventListener('pagehide', function () { if (enAttente) sauvegarderMaintenant(); });
    return chargerDossier().then(function () {
      // Une copie du jour dès l'ouverture, si elle n'existe pas encore.
      var meta = lireMeta();
      if (!meta.derniereCopie || jour(new Date(meta.derniereCopie)) !== jour()) {
        return sauvegarderMaintenant();
      }
      surChangement();
    });
  }

  // Résumé pour l'affichage.
  function etat() {
    var meta = lireMeta();
    var reference = [meta.dernierDossier, meta.dernierExport].filter(Boolean).sort().pop() || null;
    var jours = reference ? Math.floor((Date.now() - new Date(reference).getTime()) / 86400000) : null;
    return {
      mode: permission,
      nomDossier: (dossier && dossier.name) || meta.nomDossier || '',
      dernierDossier: meta.dernierDossier || null,
      dernierExport: meta.dernierExport || null,
      derniereCopie: meta.derniereCopie || null,
      enAttente: enAttente,
      erreur: derniereErreur,
      // Rappel : rien n'a été sauvegardé hors du navigateur depuis 7 jours (ou jamais).
      rappel: permission !== 'actif' && (jours === null || jours >= RAPPEL_JOURS),
      joursSansSauvegarde: jours
    };
  }

  function noterExportManuel() {
    ecrireMeta({ dernierExport: new Date().toISOString() });
    surChangement();
  }

  racine.SPSauvegarde = {
    demarrer: demarrer,
    signalerModification: signalerModification,
    sauvegarderMaintenant: sauvegarderMaintenant,
    choisirDossier: choisirDossier,
    reautoriser: reautoriser,
    arreterDossier: arreterDossier,
    dossierPossible: dossierPossible,
    listerCopies: listerCopies,
    lireCopie: lireCopie,
    noterExportManuel: noterExportManuel,
    jour: jour,
    etat: etat
  };
})(window);
