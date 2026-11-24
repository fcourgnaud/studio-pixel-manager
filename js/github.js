/*
 * Studio Pixel — Manager
 * github.js : sauvegarde en ligne dans un dépôt GitHub privé.
 *
 * Le Manager enregistre ses données dans un fichier JSON du dépôt privé
 * (par défaut : dépôt Studio-Pixel, branche « donnees-manager »,
 * fichier « manager/donnees.json »). Chaque sauvegarde est un commit :
 * l'historique complet est donc conservé par GitHub.
 *
 * L'accès se fait avec une clé personnelle GitHub (« fine-grained token »)
 * que la directrice colle elle-même dans la page. Cette clé :
 *   - reste dans ce navigateur (jamais dans le code, jamais envoyée ailleurs
 *     qu'à api.github.com) ;
 *   - n'est mémorisée sur l'appareil que si la case est cochée ;
 *   - doit être limitée au seul dépôt Studio-Pixel, droit « Contents » en lecture
 *     et écriture.
 */
(function (racine) {
  'use strict';

  var API = 'https://api.github.com';
  var CLE_CONFIG = 'studioPixelManager.github';
  var CLE_JETON = 'studioPixelManager.github.jeton';
  var DELAI_MS = 30 * 1000;

  var DEFAUTS = { proprietaire: 'fcourgnaud', depot: 'Studio-Pixel', branche: 'donnees-manager', chemin: 'manager/donnees.json' };

  var fournisseur = null;          // renvoie le texte JSON à envoyer
  var surChangement = function () {};
  var minuterie = null;
  var envoiEnCours = null;
  var statut = { mode: 'deconnecte', erreur: '', enAttente: false };

  // ---------------------------------------------------------------- Réglages enregistrés

  function lireConfig() {
    var c = {};
    try { c = JSON.parse(racine.localStorage.getItem(CLE_CONFIG)) || {}; } catch (e) { c = {}; }
    return Object.assign({}, DEFAUTS, c);
  }
  function ecrireConfig(changements) {
    var c = Object.assign(lireConfig(), changements);
    try { racine.localStorage.setItem(CLE_CONFIG, JSON.stringify(c)); } catch (e) { /* rien */ }
    return c;
  }

  function lireJeton() {
    try { return racine.sessionStorage.getItem(CLE_JETON) || racine.localStorage.getItem(CLE_JETON) || ''; } catch (e) { return ''; }
  }
  function ecrireJeton(jeton, memoriser) {
    try {
      racine.localStorage.removeItem(CLE_JETON);
      racine.sessionStorage.removeItem(CLE_JETON);
      if (jeton) (memoriser ? racine.localStorage : racine.sessionStorage).setItem(CLE_JETON, jeton);
    } catch (e) { /* rien */ }
  }

  // ---------------------------------------------------------------- Encodage (UTF-8 ⇄ base64)

  function versBase64(texte) {
    var octets = new TextEncoder().encode(texte);
    var binaire = '';
    for (var i = 0; i < octets.length; i += 0x8000) {
      binaire += String.fromCharCode.apply(null, octets.subarray(i, i + 0x8000));
    }
    return racine.btoa(binaire);
  }
  function depuisBase64(b64) {
    var binaire = racine.atob(String(b64).replace(/\s/g, ''));
    var octets = new Uint8Array(binaire.length);
    for (var i = 0; i < binaire.length; i++) octets[i] = binaire.charCodeAt(i);
    return new TextDecoder().decode(octets);
  }

  // ---------------------------------------------------------------- Appels à l'API GitHub

  function erreurLisible(code, corps) {
    if (code === 401) return 'Clé GitHub refusée (expirée ou mal copiée).';
    if (code === 403) return 'Accès refusé : la clé doit avoir le droit « Contents : Read and write » sur ce dépôt.';
    if (code === 404) return 'Dépôt introuvable, ou la clé n\'y a pas accès.';
    return 'GitHub a répondu une erreur (' + code + ')' + (corps && corps.message ? ' : ' + corps.message : '') + '.';
  }

  function appel(methode, chemin, corps, brut) {
    var jeton = lireJeton();
    if (!jeton) return Promise.reject(new Error('Aucune clé GitHub sur cet appareil.'));
    var options = {
      method: methode,
      headers: {
        'Authorization': 'Bearer ' + jeton,
        'Accept': brut ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      cache: 'no-store'
    };
    if (corps) { options.body = JSON.stringify(corps); options.headers['Content-Type'] = 'application/json'; }
    return racine.fetch(API + chemin, options).then(function (r) {
      if (brut && r.ok) return r.text().then(function (t) { return { code: r.status, corps: t }; });
      return r.text().then(function (t) {
        var json = null;
        try { json = t ? JSON.parse(t) : null; } catch (e) { json = null; }
        return { code: r.status, corps: json };
      });
    }, function () {
      throw new Error('GitHub injoignable (pas de connexion Internet ?).');
    });
  }

  function cheminDepot(c) {
    return '/repos/' + encodeURIComponent(c.proprietaire) + '/' + encodeURIComponent(c.depot);
  }
  function cheminFichier(c) {
    return cheminDepot(c) + '/contents/' + c.chemin.split('/').map(encodeURIComponent).join('/');
  }

  // Crée la branche de données si elle n'existe pas encore (à partir de la branche par défaut).
  function assurerBranche(c) {
    return appel('GET', cheminDepot(c) + '/branches/' + encodeURIComponent(c.branche)).then(function (r) {
      if (r.code === 200) return;
      if (r.code !== 404) throw new Error(erreurLisible(r.code, r.corps));
      return appel('GET', cheminDepot(c)).then(function (d) {
        if (d.code !== 200) throw new Error(erreurLisible(d.code, d.corps));
        return appel('GET', cheminDepot(c) + '/git/ref/heads/' + encodeURIComponent(d.corps.default_branch));
      }).then(function (ref) {
        if (ref.code !== 200) throw new Error(erreurLisible(ref.code, ref.corps));
        return appel('POST', cheminDepot(c) + '/git/refs', { ref: 'refs/heads/' + c.branche, sha: ref.corps.object.sha });
      }).then(function (cree) {
        if (cree.code !== 201) throw new Error(erreurLisible(cree.code, cree.corps));
      });
    });
  }

  // Lit le fichier de données. Renvoie null s'il n'existe pas encore.
  function lireDistant() {
    var c = lireConfig();
    var chemin = cheminFichier(c) + '?ref=' + encodeURIComponent(c.branche);
    return appel('GET', chemin).then(function (r) {
      if (r.code === 404) return null;
      if (r.code !== 200) throw new Error(erreurLisible(r.code, r.corps));
      var sha = r.corps.sha;
      if (r.corps.content && r.corps.encoding === 'base64') return { texte: depuisBase64(r.corps.content), sha: sha };
      // Fichier de plus de 1 Mo : GitHub ne l'inclut pas, on le demande brut.
      return appel('GET', chemin, null, true).then(function (b) {
        if (b.code !== 200) throw new Error(erreurLisible(b.code, null));
        return { texte: b.corps, sha: sha };
      });
    });
  }

  function horodatage() {
    var d = new Date();
    return d.toLocaleDateString('fr-FR') + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  // Envoie le texte. Si le fichier a changé ailleurs depuis la dernière fois, signale un conflit.
  function ecrireDistant(texte) {
    var c = lireConfig();
    var corps = { message: 'Sauvegarde du Manager — ' + horodatage(), content: versBase64(texte), branch: c.branche };
    if (c.sha) corps.sha = c.sha;
    return appel('PUT', cheminFichier(c), corps).then(function (r) {
      if (r.code === 200 || r.code === 201) {
        ecrireConfig({ sha: r.corps.content.sha, dernierEnvoi: new Date().toISOString(), localModifie: false });
        return true;
      }
      if (r.code === 409 || r.code === 422) {
        var e = new Error('Les données en ligne ont été modifiées depuis un autre appareil.');
        e.conflit = true;
        throw e;
      }
      throw new Error(erreurLisible(r.code, r.corps));
    });
  }

  // ---------------------------------------------------------------- Opérations utilisées par l'interface

  function estConnecte() {
    return !!lireJeton() && !!lireConfig().connecte;
  }

  /*
   * Connexion : vérifie la clé et le dépôt, crée la branche si besoin,
   * puis renvoie le contenu en ligne (ou null s'il n'y en a pas encore).
   */
  function connecter(reglages) {
    var jeton = String(reglages.jeton || '').trim();
    if (!jeton) return Promise.reject(new Error('Collez la clé GitHub.'));
    ecrireJeton(jeton, !!reglages.memoriser);
    var c = ecrireConfig({
      proprietaire: String(reglages.proprietaire || DEFAUTS.proprietaire).trim(),
      depot: String(reglages.depot || DEFAUTS.depot).trim(),
      branche: String(reglages.branche || DEFAUTS.branche).trim(),
      connecte: false, sha: '', localModifie: true
    });
    return appel('GET', cheminDepot(c)).then(function (r) {
      if (r.code !== 200) throw new Error(erreurLisible(r.code, r.corps));
      if (r.corps.private === false) throw new Error('Ce dépôt est public : les données y seraient visibles par tous. Choisissez un dépôt privé.');
      if (r.corps.permissions && r.corps.permissions.push === false) throw new Error('La clé ne permet pas d\'écrire dans ce dépôt.');
      return assurerBranche(c);
    }).then(function () {
      return lireDistant();
    }).then(function (distant) {
      ecrireConfig({ connecte: true, sha: distant ? distant.sha : '' });
      statut.mode = 'connecte'; statut.erreur = '';
      surChangement();
      return distant;
    }).catch(function (e) {
      ecrireJeton('', false);
      ecrireConfig({ connecte: false });
      statut.mode = 'deconnecte';
      throw e;
    });
  }

  function deconnecter() {
    clearTimeout(minuterie);
    ecrireJeton('', false);
    ecrireConfig({ connecte: false, sha: '' });
    statut = { mode: 'deconnecte', erreur: '', enAttente: false };
    surChangement();
  }

  // Envoie maintenant (sans attendre le délai).
  function envoyer() {
    if (!estConnecte() || !fournisseur) return Promise.resolve(false);
    clearTimeout(minuterie);
    minuterie = null;
    if (envoiEnCours) return envoiEnCours;
    statut.enAttente = false;
    envoiEnCours = ecrireDistant(fournisseur()).then(function () {
      statut.mode = 'connecte'; statut.erreur = '';
      return true;
    }, function (e) {
      statut.mode = e.conflit ? 'conflit' : 'erreur';
      statut.erreur = e.message;
      statut.enAttente = true;
      throw e;
    }).finally(function () {
      envoiEnCours = null;
      surChangement();
    });
    return envoiEnCours;
  }

  function signalerModification() {
    ecrireConfig({ localModifie: true });
    if (!estConnecte() || statut.mode === 'conflit') return;
    statut.enAttente = true;
    clearTimeout(minuterie);
    minuterie = setTimeout(function () { envoyer().catch(function () { /* affiché par l'interface */ }); }, DELAI_MS);
  }

  // Après le chargement de la version en ligne dans l'appareil.
  function marquerAJour(sha) {
    ecrireConfig({ sha: sha, localModifie: false });
    statut.mode = 'connecte'; statut.erreur = ''; statut.enAttente = false;
    surChangement();
  }

  // Résolution d'un conflit en gardant les données de cet appareil : on écrase la version en ligne.
  function forcerEnvoi() {
    return lireDistant().then(function (d) {
      ecrireConfig({ sha: d ? d.sha : '' });
      statut.mode = 'connecte';
      return envoyer();
    });
  }

  function demarrer(options) {
    fournisseur = options.fournisseur;
    surChangement = options.surChangement || surChangement;
    statut.mode = estConnecte() ? 'connecte' : 'deconnecte';
    racine.addEventListener('pagehide', function () { if (statut.enAttente && estConnecte()) envoyer().catch(function () {}); });
    if (!estConnecte()) return Promise.resolve({ action: 'aucune' });
    // Au démarrage : récupérer ce qui a pu être enregistré depuis un autre appareil.
    return lireDistant().then(function (distant) {
      var c = lireConfig();
      if (!distant) return { action: 'envoyer' };
      if (distant.sha === c.sha) return { action: c.localModifie ? 'envoyer' : 'aucune' };
      return { action: c.localModifie ? 'conflit' : 'charger', distant: distant };
    }).catch(function (e) {
      statut.mode = 'erreur'; statut.erreur = e.message;
      surChangement();
      return { action: 'erreur', erreur: e };
    });
  }

  function etat() {
    var c = lireConfig();
    return {
      mode: statut.mode,
      connecte: estConnecte(),
      erreur: statut.erreur,
      enAttente: statut.enAttente,
      dernierEnvoi: c.dernierEnvoi || null,
      proprietaire: c.proprietaire, depot: c.depot, branche: c.branche, chemin: c.chemin,
      memorise: (function () { try { return !!racine.localStorage.getItem(CLE_JETON); } catch (e) { return false; } })()
    };
  }

  racine.SPGithub = {
    DEFAUTS: DEFAUTS,
    demarrer: demarrer,
    connecter: connecter,
    deconnecter: deconnecter,
    envoyer: envoyer,
    forcerEnvoi: forcerEnvoi,
    lireDistant: lireDistant,
    marquerAJour: marquerAJour,
    signalerModification: signalerModification,
    estConnecte: estConnecte,
    etat: etat
  };
})(window);
