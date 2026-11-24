/*
 * Studio Pixel — Manager
 * app.js : l'interface (affichage, formulaires, navigation).
 *
 * Toute la logique des données est dans modele.js ; ce fichier ne fait que
 * l'afficher et réagir aux clics. Les données sont enregistrées dans le
 * navigateur (localStorage) à chaque modification.
 */
(function () {
  'use strict';

  var M = window.SPModele;
  // Version publique (GitHub Pages) : aucune donnée de départ n'est publiée.
  var MODE_PUBLIC = window.SPDonneesInitiales === null;
  var CLE_STOCKAGE = 'studioPixelManager.v1';
  var TAILLE_MAX_IMAGE = 1.5 * 1024 * 1024; // 1,5 Mo par image intégrée
  var TAILLE_MAX_AUDIO = 3 * 1024 * 1024;   // 3 Mo par son intégré

  var etat;            // toutes les données
  var ui = {           // ce qui est affiché en ce moment (non enregistré)
    module: 'tableau',
    recherche: '',
    texteModule: '',
    statut: '',
    comparaison: [],
    brouillon: null,   // fiche en cours de modification
    brouillonModule: null
  };

  var el = {
    app: document.getElementById('app'),
    nav: document.getElementById('navigation'),
    contenu: document.getElementById('contenu'),
    fenetre: document.getElementById('fenetre'),
    toasts: document.getElementById('toasts'),
    recherche: document.getElementById('recherche-globale'),
    etatSauvegarde: document.getElementById('etat-sauvegarde'),
    fichierImport: document.getElementById('fichier-import')
  };

  // ------------------------------------------------------------ Utilitaires

  // Protège tout texte affiché (évite qu'un contenu soit interprété comme du code).
  function esc(texte) {
    return String(texte == null ? '' : texte)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function toast(message, erreur) {
    var t = document.createElement('div');
    t.className = 'toast' + (erreur ? ' erreur' : '');
    t.textContent = message;
    // Quand la fenêtre d'édition est ouverte, le message s'affiche dans la fenêtre (sinon il serait caché derrière).
    var parent = el.fenetre.open ? el.fenetre : document.body;
    if (el.toasts.parentNode !== parent) parent.appendChild(el.toasts);
    el.toasts.appendChild(t);
    setTimeout(function () { t.remove(); }, erreur ? 6000 : 3000);
  }

  function dateFr(iso) {
    if (!iso) return '';
    var d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso);
    if (isNaN(d)) return iso;
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function euros(n) {
    return (Number(n) || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
  }

  function lignes(texte) {
    return String(texte || '').split(/\n/).map(function (l) { return l.trim(); }).filter(Boolean);
  }

  function badgeStatut(statut) {
    return '<span class="statut ' + esc(statut) + '">' + esc(M.libelleStatut(statut)) + '</span>';
  }

  function premierTexteLong(module, fiche) {
    for (var i = 0; i < module.champs.length; i++) {
      var c = module.champs[i];
      if ((c.type === 'zone' || c.type === 'copiable') && fiche[c.cle]) return fiche[c.cle];
    }
    return '';
  }

  function imagesDeFiche(module, fiche) {
    var res = [];
    module.champs.forEach(function (c) {
      if (c.type === 'images' && Array.isArray(fiche[c.cle])) res = res.concat(fiche[c.cle]);
      if (c.type === 'image' && fiche[c.cle]) res.push(fiche[c.cle]);
    });
    return res.filter(function (s) { return M.estMediaSur(s, 'image'); });
  }

  function titreFiche(idModule, id) {
    var f = M.trouverFiche(etat, idModule, id);
    return f ? f.titre : null;
  }

  // ------------------------------------------------------------ Enregistrement

  function lireStockage() {
    try { return window.localStorage.getItem(CLE_STOCKAGE); } catch (e) { return null; }
  }

  function charger() {
    var texte = lireStockage();
    if (texte) {
      try { return M.importerJSON(texte); } catch (e) {
        // Données abîmées : on les met de côté au lieu de les perdre.
        try { window.localStorage.setItem(CLE_STOCKAGE + '.illisible', texte); } catch (e2) { /* rien */ }
        setTimeout(function () { toast('Les données enregistrées étaient illisibles : elles ont été mises de côté et les données de départ sont chargées.', true); }, 300);
      }
    }
    return M.creerEtat(window.SPDonneesInitiales);
  }

  function sauver(depuisGithub) {
    try {
      window.localStorage.setItem(CLE_STOCKAGE, JSON.stringify(etat));
      var h = new Date();
      el.etatSauvegarde.textContent = 'Enregistré à ' + h.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      if (window.SPSauvegarde) window.SPSauvegarde.signalerModification();
      if (window.SPGithub && !depuisGithub) window.SPGithub.signalerModification();
      return true;
    } catch (e) {
      el.etatSauvegarde.textContent = 'Non enregistré';
      toast('Impossible d\'enregistrer : l\'espace du navigateur est peut-être plein. Exportez vos données et remplacez les images intégrées par des liens Drive.', true);
      return false;
    }
  }

  function tailleStockage() {
    var t = lireStockage();
    return t ? t.length * 2 : 0; // environ 2 octets par caractère
  }

  // ------------------------------------------------------------ Navigation

  function lireAdresse() {
    var id = (location.hash || '').replace(/^#\/?/, '');
    ui.module = M.trouverModule(id) ? id : 'tableau';
  }

  function aller(idModule) {
    ui.recherche = '';
    el.recherche.value = '';
    if (location.hash === '#/' + idModule) { changerModule(); } else { location.hash = '#/' + idModule; }
  }

  function changerModule() {
    lireAdresse();
    ui.texteModule = '';
    ui.statut = '';
    ui.comparaison = [];
    el.app.classList.remove('menu-ouvert');
    afficher();
    el.contenu.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  function afficherMenu() {
    el.nav.innerHTML = M.MODULES.map(function (m) {
      var nb = m.id === 'tableau' ? '' : etat.collections[m.id].length;
      return '<a href="#/' + m.id + '" class="' + (m.id === ui.module && !ui.recherche ? 'actif' : '') + '" title="' + esc(m.titre) + '">' +
        '<span class="ico" aria-hidden="true">' + m.icone + '</span><span class="lib">' + esc(m.titre) + '</span>' +
        '<span class="nb">' + nb + '</span></a>';
    }).join('');
  }

  function appliquerApparence() {
    document.documentElement.setAttribute('data-theme', etat.reglages.theme === 'clair' ? 'clair' : 'sombre');
    el.app.classList.toggle('replie', !!etat.reglages.menuReplie);
  }

  // ------------------------------------------------------------ Affichage principal

  function afficher() {
    afficherMenu();
    if (ui.recherche.trim()) { el.contenu.innerHTML = vueRecherche(); return; }
    var module = M.trouverModule(ui.module);
    document.title = module.titre + ' — Studio Pixel Manager';
    if (module.vue === 'tableau') { el.contenu.innerHTML = vueTableau(module); remplirCopies(); }
    else if (module.vue === 'budget') el.contenu.innerHTML = vueBudget(module);
    else el.contenu.innerHTML = vueModule(module);
  }

  function enteteModule(module) {
    return '<h1>' + module.icone + ' ' + esc(module.titre) + '</h1><p class="sous-titre">' + esc(module.description) + '</p>';
  }

  // Barre d'outils commune : recherche dans le module, filtre par statut, bouton d'ajout.
  function barreOutils(module, total) {
    var puces = '<button type="button" class="puce ' + (!ui.statut ? 'active' : '') + '" data-action="statut" data-statut="">Tous (' + total + ')</button>' +
      M.STATUTS.map(function (s) {
        var n = etat.collections[module.id].filter(function (f) { return f.statut === s.cle; }).length;
        return '<button type="button" class="puce ' + (ui.statut === s.cle ? 'active' : '') + '" data-action="statut" data-statut="' + s.cle + '">' + esc(s.libelle) + ' (' + n + ')</button>';
      }).join('');
    return '<div class="outils">' +
      '<input type="search" class="recherche-module" data-role="recherche-module" placeholder="Filtrer : ' + esc(module.titre.toLowerCase()) + '…" value="' + esc(ui.texteModule) + '" aria-label="Filtrer ce module">' +
      '<div class="puces" role="group" aria-label="Filtrer par statut">' + puces + '</div>' +
      '<button type="button" class="btn primaire" data-action="nouveau" data-module="' + module.id + '">＋ Ajouter</button>' +
      '</div>';
  }

  function fichesFiltrees(module) {
    return M.filtrerFiches(etat.collections[module.id], { texte: ui.texteModule, statut: ui.statut });
  }

  function vueModule(module) {
    var fiches = fichesFiltrees(module);
    var html = enteteModule(module) + barreOutils(module, etat.collections[module.id].length);

    if (module.dependances) html += blocDependances();
    if (module.comparer && ui.comparaison.length) html += blocComparaison(module);

    if (!etat.collections[module.id].length) {
      return html + '<div class="vide">Aucune fiche pour l\'instant.<br><br><button type="button" class="btn primaire" data-action="nouveau" data-module="' + module.id + '">＋ Ajouter une ' + esc(module.nomFiche) + '</button></div>';
    }
    if (!fiches.length) return html + '<div class="vide">Aucun résultat pour ce filtre.</div>';

    var rendu = module.vue === 'galerie' ? rendreGalerie : rendreListe;
    if (module.groupe) {
      M.regrouper(fiches, module.groupe).forEach(function (g) {
        html += '<div class="groupe-titre">' + esc(g.nom) + ' · ' + g.fiches.length + '</div>' + rendu(module, g.fiches);
      });
    } else {
      html += rendu(module, M.trierFiches(fiches));
    }
    return html;
  }

  function metaFiche(module, fiche) {
    var meta = [];
    module.champs.forEach(function (c) {
      var v = fiche[c.cle];
      if (c.type === 'choix' && v && c.cle !== module.groupe) meta.push('<span class="etiquette">' + esc(v) + '</span>');
      if (c.type === 'liens' && lignes(v).length) meta.push('<span class="etiquette">🔗 ' + lignes(v).length + '</span>');
      if (c.type === 'lien' && v && M.estLienSur(v)) meta.push('<a class="etiquette" href="' + esc(v) + '" target="_blank" rel="noopener" data-action="lien">🔗 ' + esc(c.libelle) + '</a>');
      if (c.type === 'montant' && v !== '' && v != null) meta.push('<span class="etiquette">' + euros(v) + '</span>');
      if (c.type === 'montant' && (v === '' || v == null)) meta.push('<span class="etiquette">montant à renseigner</span>');
      if (c.type === 'date' && v) meta.push('<span class="etiquette">' + esc(dateFr(v)) + '</span>');
      if (c.cle === 'numero' && v) meta.push('<span class="etiquette">' + esc(v) + '</span>');
    });
    if (module.dependances) {
      var dep = M.analyserDependances(etat);
      if (dep.bloquees[fiche.id]) {
        var noms = dep.bloquees[fiche.id].map(function (id) { return titreFiche('gamedesign', id); }).filter(Boolean);
        meta.push('<span class="etiquette alerte" title="' + esc('Nécessite : ' + noms.join(', ')) + '">⛓ bloquée par ' + noms.length + '</span>');
      }
    }
    meta.push(badgeStatut(fiche.statut));
    return meta.join('');
  }

  function rendreListe(module, fiches) {
    return '<div class="liste">' + fiches.map(function (f) {
      var extrait = premierTexteLong(module, f);
      var lecteur = '';
      module.champs.forEach(function (c) {
        if (c.type === 'audio' && M.estMediaSur(f[c.cle], 'audio')) {
          lecteur = '<audio controls preload="none" src="' + esc(f[c.cle]) + '" data-action="lecteur" style="grid-column:1/-1;width:100%"></audio>';
        }
      });
      var copie = '';
      module.champs.forEach(function (c) {
        if (c.type === 'copiable' && f[c.cle]) {
          copie = '<div style="grid-column:1/-1"><button type="button" class="btn petit" data-action="copier" data-module="' + module.id + '" data-id="' + esc(f.id) + '" data-champ="' + c.cle + '">⧉ Copier les instructions</button></div>';
        }
      });
      return '<div class="ligne" role="button" tabindex="0" data-action="ouvrir" data-module="' + module.id + '" data-id="' + esc(f.id) + '">' +
        '<div class="titre">' + esc(f.titre) + '</div><div class="meta">' + metaFiche(module, f) + '</div>' +
        (extrait ? '<div class="extrait">' + esc(extrait) + '</div>' : '') + lecteur + copie + '</div>';
    }).join('') + '</div>';
  }

  function rendreGalerie(module, fiches) {
    return '<div class="grille">' + fiches.map(function (f) {
      var imgs = imagesDeFiche(module, f);
      var visuel = imgs.length
        ? (imgs.length === 1 ? '<img class="vignette-unique" src="' + esc(imgs[0]) + '" alt="">' :
          '<div class="vignettes">' + imgs.slice(0, 3).map(function (s) { return '<img src="' + esc(s) + '" alt="" loading="lazy">'; }).join('') + '</div>')
        : '<div class="vide-image">Pas encore d\'image</div>';
      var couleurs = Array.isArray(f.couleurs) && f.couleurs.length
        ? '<div class="nuancier">' + f.couleurs.filter(M.estCouleur).map(function (c) { return '<span style="background:' + esc(c) + '" title="' + esc(c) + '"></span>'; }).join('') + '</div>' : '';
      var extrait = premierTexteLong(module, f);
      var comparer = module.comparer
        ? '<label class="etiquette" data-action="comparer" data-id="' + esc(f.id) + '"><input type="checkbox" ' + (ui.comparaison.indexOf(f.id) !== -1 ? 'checked' : '') + ' tabindex="-1"> Comparer</label>' : '';
      return '<div class="carte cliquable" role="button" tabindex="0" data-action="ouvrir" data-module="' + module.id + '" data-id="' + esc(f.id) + '">' +
        visuel + '<div class="entete"><h3>' + esc(f.titre) + '</h3></div>' + couleurs +
        (extrait ? '<div class="extrait">' + esc(extrait) + '</div>' : '') +
        '<div class="meta">' + metaFiche(module, f) + comparer + '</div></div>';
    }).join('') + '</div>';
  }

  function blocDependances() {
    var dep = M.analyserDependances(etat);
    var enigmes = etat.collections.gamedesign;
    if (!enigmes.length) return '';
    if (dep.boucles.length) {
      return '<div class="alerte-boite"><strong>Boucle de dépendances :</strong> ' + dep.boucles.map(function (b) {
        return b.map(function (id) { return esc(titreFiche('gamedesign', id)); }).join(' → ');
      }).join('<br>') + '<br>Le joueur ne pourrait jamais avancer : retirez un des prérequis.</div>';
    }
    var nbBloquees = Object.keys(dep.bloquees).length;
    return '<details class="info-boite"><summary><strong>Ordre de résolution possible</strong> · ' + enigmes.length + ' énigmes, ' +
      nbBloquees + ' en attente d\'un prérequis non validé</summary><ol>' +
      dep.ordre.map(function (id) { return '<li>' + esc(titreFiche('gamedesign', id)) + '</li>'; }).join('') + '</ol></details>';
  }

  function blocComparaison(module) {
    var fiches = ui.comparaison.map(function (id) { return M.trouverFiche(etat, module.id, id); }).filter(Boolean);
    if (fiches.length < 2) {
      return '<div class="info-boite">Comparaison : cochez une deuxième fiche. <button type="button" class="btn petit" data-action="fin-comparaison">Annuler</button></div>';
    }
    return '<h2>Comparaison <button type="button" class="btn petit" data-action="fin-comparaison">Fermer</button></h2><div class="comparaison">' +
      fiches.map(function (f) {
        var imgs = imagesDeFiche(module, f);
        return '<div class="carte"><div class="entete"><h3>' + esc(f.titre) + '</h3>' + badgeStatut(f.statut) + '</div>' +
          imgs.map(function (s) { return '<img src="' + esc(s) + '" alt="">'; }).join('') +
          (Array.isArray(f.couleurs) ? '<div class="nuancier">' + f.couleurs.filter(M.estCouleur).map(function (c) { return '<span style="background:' + esc(c) + '" title="' + esc(c) + '"></span>'; }).join('') + '</div>' : '') +
          (f.categorie ? '<div><span class="etiquette">' + esc(f.categorie) + '</span></div>' : '') +
          (f.regles ? '<div style="white-space:pre-wrap">' + esc(f.regles) + '</div>' : '') +
          (f.notes ? '<div class="extrait" style="white-space:pre-wrap">' + esc(f.notes) + '</div>' : '') + '</div>';
      }).join('') + '</div>';
  }

  // ------------------------------------------------------------ Tableau de bord

  function barreProgres(a) {
    if (!a.total) return '<div class="barre-progres"></div>';
    return '<div class="barre-progres" role="img" aria-label="' + a.valide + ' validées, ' + a.a_valider + ' à valider, ' + a.en_cours + ' en cours, sur ' + a.total + '">' +
      ['valide', 'a_valider', 'en_cours'].map(function (s) { return '<span class="' + s + '" style="width:' + (a[s] / a.total * 100) + '%"></span>'; }).join('') + '</div>';
  }

  function vueTableau(module) {
    var p = etat.projet;
    var av = M.avancementGlobal(etat);
    var budget = M.syntheseBudget(etat);
    var aValider = [];
    M.MODULES.forEach(function (m) {
      if (m.id === 'tableau') return;
      etat.collections[m.id].forEach(function (f) { if (f.statut === 'a_valider') aValider.push({ m: m, f: f }); });
    });
    var missions = M.trierFiches(etat.collections.developpement.filter(function (f) { return f.statut === 'en_cours' || f.statut === 'a_faire' || f.statut === 'a_valider'; }));

    var html = '<h1>' + esc(p.nom || 'Projet sans nom') + '</h1><p class="sous-titre">' + esc(p.genre) + '</p>';

    html += '<div class="indicateurs">' +
      '<div class="carte indicateur"><div class="valeur">' + av.global.pourcentage + ' %</div><div class="legende">De la production validée · barre : validé, à valider, en cours</div>' + barreProgres(av.global) + '</div>' +
      '<div class="carte indicateur"><div class="valeur">' + av.global.a_valider + '</div><div class="legende">Éléments à valider par la directrice</div></div>' +
      '<div class="carte indicateur"><div class="valeur">' + missions.length + '</div><div class="legende">Missions en cours ou à venir</div></div>' +
      '<div class="carte indicateur"><div class="valeur">' + euros(budget.additionnelEngage) + '</div><div class="legende">Dépenses additionnelles (plafond ' + euros(budget.plafond) + ')</div></div>' +
      '</div>';

    html += '<div class="colonnes" style="margin-top:14px">' +
      '<div class="carte projet"><div class="entete"><h3>Le projet</h3><button type="button" class="btn petit" data-action="modifier-projet">Modifier</button></div><dl>' +
      '<dt>Phase</dt><dd>' + esc(p.phase) + '</dd><dt>Durée cible</dt><dd>' + esc(p.dureeCible) + '</dd><dt>Moteur</dt><dd>' + esc(p.moteur) + '</dd></dl>' +
      (p.resume ? '<p class="extrait" style="-webkit-line-clamp:unset">' + esc(p.resume) + '</p>' : '') + '</div>' +
      '<div class="carte"><div class="entete"><h3>Accès aux outils</h3><button type="button" class="btn petit" data-action="modifier-outils">Modifier</button></div><div class="liens-outils">' +
      etat.outils.filter(function (o) { return M.estLienSur(o.url); }).map(function (o) { return '<a class="btn petit" href="' + esc(o.url) + '" target="_blank" rel="noopener">' + esc(o.nom) + ' ↗</a>'; }).join('') +
      '</div></div></div>';

    html += '<h2>Avancement par module</h2><div class="progres-modules">' + M.MODULES.filter(function (m) { return av.parModule[m.id]; }).map(function (m) {
      var a = av.parModule[m.id];
      return '<a class="carte progres-module" href="#/' + m.id + '"><span>' + m.icone + ' ' + esc(m.titre) + '</span><span class="etiquette">' + a.valide + '/' + a.total + ' validés</span>' + barreProgres(a) + '</a>';
    }).join('') + '</div>';

    html += '<div class="colonnes">' +
      '<div><h2>À valider par la directrice (' + aValider.length + ')</h2><div class="liste">' +
      (aValider.length ? aValider.slice(0, 10).map(function (x) {
        return '<div class="ligne" role="button" tabindex="0" data-action="ouvrir" data-module="' + x.m.id + '" data-id="' + esc(x.f.id) + '"><div class="titre">' + esc(x.f.titre) + '</div><div class="meta"><span class="etiquette">' + esc(x.m.titre) + '</span></div></div>';
      }).join('') + (aValider.length > 10 ? '<p class="sous-titre">… et ' + (aValider.length - 10) + ' autres (filtre « À valider » dans chaque module).</p>' : '') : '<div class="vide">Rien à valider.</div>') + '</div></div>' +
      '<div><h2>Missions de développement</h2><div class="liste">' +
      (missions.length ? missions.map(function (f) {
        return '<div class="ligne" role="button" tabindex="0" data-action="ouvrir" data-module="developpement" data-id="' + esc(f.id) + '"><div class="titre">' + esc(f.titre) + '</div><div class="meta">' + badgeStatut(f.statut) + '</div></div>';
      }).join('') : '<div class="vide">Aucune mission en cours.</div>') + '</div></div></div>';

    html += '<h2>Sauvegardes et données</h2><div class="carte" id="bloc-sauvegarde">' + blocSauvegarde() + '</div>';

    html += '<h2>Registre des décisions</h2>' + barreOutils(module, etat.collections.tableau.length);
    var decisions = fichesFiltrees(module);
    html += decisions.length ? rendreListe(module, decisions.slice().sort(function (a, b) { return String(a.numero).localeCompare(String(b.numero), 'fr', { numeric: true }); })) : '<div class="vide">Aucune décision pour ce filtre.</div>';
    return html;
  }

  // ------------------------------------------------------------ Budget

  function vueBudget(module) {
    var s = M.syntheseBudget(etat);
    var html = enteteModule(module);
    if (s.depassement) html += '<div class="alerte-boite"><strong>Plafond dépassé :</strong> les dépenses engagées (' + euros(s.additionnelEngage) + ') dépassent le plafond autorisé (' + euros(s.plafond) + ').</div>';
    if (s.nonAutorisees.length) html += '<div class="alerte-boite"><strong>Dépense sans autorisation :</strong> ' + s.nonAutorisees.map(function (l) { return esc(l.titre); }).join(', ') + '. Toute dépense doit être accordée par la directrice avant d\'être engagée.</div>';
    html += '<div class="indicateurs">' +
      '<div class="carte indicateur"><label class="legende" for="plafond">Plafond de dépenses additionnelles</label><div class="valeur"><input id="plafond" type="number" min="0" step="1" data-role="plafond" value="' + esc(s.plafond) + '" style="font-size:22px;font-weight:700;width:140px"> €</div><div class="legende">Au-delà, aucune dépense sans nouvel accord.</div></div>' +
      '<div class="carte indicateur"><div class="valeur">' + euros(s.additionnelEngage) + '</div><div class="legende">Dépenses additionnelles engagées · reste ' + euros(s.reste) + '</div></div>' +
      '<div class="carte indicateur"><div class="valeur">' + euros(s.abonnementsMensuels) + '<small style="font-size:14px"> / mois</small></div><div class="legende">Abonnements existants' + (s.montantsInconnus ? ' · ' + s.montantsInconnus + ' montant(s) à renseigner' : '') + '</div></div>' +
      '<div class="carte indicateur"><div class="valeur">' + euros(s.previsions) + '</div><div class="legende">Prévisions (non engagées)</div></div>' +
      '</div><h2>Lignes de budget</h2>' + barreOutils(module, etat.collections.budget.length);
    var fiches = fichesFiltrees(module);
    if (!fiches.length) return html + '<div class="vide">Aucune ligne pour ce filtre.</div>';
    M.regrouper(fiches, 'nature').forEach(function (g) {
      html += '<div class="groupe-titre">' + esc(g.nom) + '</div>' + rendreListe(module, g.fiches);
    });
    return html;
  }

  // ------------------------------------------------------------ Recherche globale

  function vueRecherche() {
    var res = M.rechercherPartout(etat, ui.recherche);
    document.title = 'Recherche — Studio Pixel Manager';
    var html = '<h1>Recherche</h1><p class="sous-titre">' + res.length + ' résultat(s) pour « ' + esc(ui.recherche) + ' »</p>';
    if (!res.length) return html + '<div class="vide">Aucun résultat.</div>';
    M.MODULES.forEach(function (m) {
      var fiches = res.filter(function (r) { return r.module === m.id; }).map(function (r) { return r.fiche; });
      if (fiches.length) html += '<div class="groupe-titre">' + m.icone + ' ' + esc(m.titre) + '</div>' + rendreListe(m, fiches);
    });
    return html;
  }

  // ------------------------------------------------------------ Fenêtre d'édition d'une fiche

  function ouvrirFiche(idModule, idFiche) {
    var module = M.trouverModule(idModule);
    var fiche = idFiche ? M.trouverFiche(etat, idModule, idFiche) : null;
    if (idFiche && !fiche) { toast('Cette fiche n\'existe plus.', true); return; }
    ui.brouillonModule = idModule;
    ui.brouillon = fiche ? JSON.parse(JSON.stringify(fiche)) : { titre: '', statut: 'a_faire' };
    if (!fiche && module.groupe && ui.texteModule === '' && module.id !== 'budget') { /* rien de prérempli */ }
    rendreFenetre();
    if (!el.fenetre.open) el.fenetre.showModal();
    var premier = el.fenetre.querySelector('input[name="c_titre"]');
    if (premier && !fiche) premier.focus();
  }

  function champHTML(c, valeur) {
    var nom = 'c_' + c.cle;
    var id = 'champ-' + c.cle;
    var lab = '<label for="' + id + '">' + esc(c.libelle) + (c.requis ? ' *' : '') + '</label>';
    switch (c.type) {
      case 'texte':
        return lab + '<input type="text" id="' + id + '" name="' + nom + '" value="' + esc(valeur) + '"' + (c.requis ? ' required' : '') + '>';
      case 'nombre':
        return lab + '<input type="number" id="' + id + '" name="' + nom + '" value="' + esc(valeur) + '" step="any">';
      case 'montant':
        return lab + '<input type="number" id="' + id + '" name="' + nom + '" value="' + esc(valeur) + '" step="0.01" min="0" placeholder="Laisser vide si inconnu">';
      case 'date':
        return lab + '<input type="date" id="' + id + '" name="' + nom + '" value="' + esc(valeur) + '">';
      case 'zone':
        return lab + '<textarea id="' + id + '" name="' + nom + '">' + esc(valeur) + '</textarea>';
      case 'copiable':
        return lab + '<textarea id="' + id + '" name="' + nom + '" style="min-height:140px;font-family:ui-monospace,Menlo,monospace;font-size:13px">' + esc(valeur) + '</textarea>' +
          '<div class="aide"><button type="button" class="btn petit" data-action="copier-champ" data-champ="' + c.cle + '">⧉ Copier</button> À coller dans Claude Code.</div>';
      case 'choix':
        return lab + '<select id="' + id + '" name="' + nom + '"><option value="">—</option>' + c.options.map(function (o) {
          return '<option' + (o === valeur ? ' selected' : '') + '>' + esc(o) + '</option>';
        }).join('') + '</select>';
      case 'lien':
        return lab + '<input type="url" id="' + id + '" name="' + nom + '" value="' + esc(valeur) + '" placeholder="https://…">' +
          (M.estLienSur(valeur) ? '<div class="aide"><a href="' + esc(valeur) + '" target="_blank" rel="noopener">Ouvrir ↗</a></div>' : '');
      case 'liens':
        return lab + '<textarea id="' + id + '" name="' + nom + '" placeholder="Une adresse par ligne">' + esc(valeur) + '</textarea>' +
          '<div class="aide">' + lignes(valeur).filter(M.estLienSur).map(function (u) { return '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(u.length > 60 ? u.slice(0, 57) + '…' : u) + ' ↗</a>'; }).join('<br>') + '</div>';
      case 'couleurs':
        var liste = Array.isArray(valeur) ? valeur : [];
        return lab + '<textarea id="' + id + '" name="' + nom + '" placeholder="Un code couleur par ligne, par exemple #1B2A4A" style="min-height:60px">' + esc(liste.join('\n')) + '</textarea>' +
          '<div class="nuancier" style="margin-top:6px">' + liste.filter(M.estCouleur).map(function (co) { return '<span style="background:' + esc(co) + '" title="' + esc(co) + '"></span>'; }).join('') + '</div>';
      case 'reference':
        var cibles = M.trierFiches(etat.collections[c.module]);
        return lab + '<select id="' + id + '" name="' + nom + '"><option value="">—</option>' + cibles.map(function (f) {
          return '<option value="' + esc(f.id) + '"' + (f.id === valeur ? ' selected' : '') + '>' + esc(f.titre) + '</option>';
        }).join('') + '</select>';
      case 'references':
        var choisis = Array.isArray(valeur) ? valeur : [];
        var options = M.trierFiches(etat.collections[c.module]).filter(function (f) {
          return !(ui.brouillonModule === c.module && f.id === ui.brouillon.id); // pas de lien vers soi-même
        });
        return '<span class="libelle">' + esc(c.libelle) + '</span><div class="choix-multiples">' +
          (options.length ? options.map(function (f) {
            return '<label><input type="checkbox" name="' + nom + '" value="' + esc(f.id) + '"' + (choisis.indexOf(f.id) !== -1 ? ' checked' : '') + '> ' + esc(f.titre) + '</label>';
          }).join('') : '<span class="aide">Aucune fiche dans « ' + esc(M.trouverModule(c.module).titre) + ' » pour l\'instant.</span>') + '</div>';
      case 'images':
      case 'image':
      case 'audio':
        return champMedia(c, valeur);
    }
    return '';
  }

  function champMedia(c, valeur) {
    var genre = c.type === 'audio' ? 'audio' : 'image';
    var liste = c.type === 'images' ? (Array.isArray(valeur) ? valeur : []) : (valeur ? [valeur] : []);
    var apercus = liste.map(function (src, i) {
      if (!M.estMediaSur(src, genre)) return '';
      if (genre === 'audio') {
        return '<div style="display:flex;gap:6px;align-items:center;width:100%"><audio controls preload="none" src="' + esc(src) + '" style="flex:1"></audio>' +
          '<button type="button" class="btn petit danger" data-action="retirer-media" data-champ="' + c.cle + '" data-index="' + i + '">Retirer</button></div>';
      }
      return '<div class="media"><img src="' + esc(src) + '" alt=""><button type="button" data-action="retirer-media" data-champ="' + c.cle + '" data-index="' + i + '" aria-label="Retirer cette image">×</button></div>';
    }).join('');
    var peutAjouter = c.type === 'images' || !liste.length;
    return '<span class="libelle">' + esc(c.libelle) + '</span><div class="medias">' + apercus + '</div>' +
      (peutAjouter ? '<div class="ajout-media">' +
        '<input type="url" data-role="url-media" data-champ="' + c.cle + '" placeholder="Adresse web de ' + (genre === 'audio' ? 'ce son' : 'l\'image') + ' (https://…)" aria-label="Adresse web">' +
        '<button type="button" class="btn petit" data-action="ajouter-url-media" data-champ="' + c.cle + '">Ajouter</button>' +
        '<label class="btn petit">Depuis l\'ordinateur…<input type="file" class="cache" data-role="fichier-media" data-champ="' + c.cle + '" accept="' + (genre === 'audio' ? 'audio/*' : 'image/png,image/jpeg,image/gif,image/webp') + '"' + (c.type === 'images' ? ' multiple' : '') + '></label>' +
        '</div><div class="aide">Fichier intégré : ' + (genre === 'audio' ? '3' : '1,5') + ' Mo maximum. Pour les gros fichiers, préférez un lien.</div>' : '');
  }

  function rendreFenetre() {
    var module = M.trouverModule(ui.brouillonModule);
    var f = ui.brouillon;
    var existe = f.id && M.trouverFiche(etat, module.id, f.id);
    var html = '<form method="dialog" id="formulaire-fiche" novalidate>' +
      '<div class="dlg-tete"><h3 id="fenetre-titre">' + (existe ? 'Modifier : ' + esc(f.titre) : 'Nouvelle ' + esc(module.nomFiche)) + '</h3>' +
      '<button type="button" class="btn icone" data-action="fermer" aria-label="Fermer">✕</button></div><div class="dlg-corps">';

    html += '<div class="champ"><label for="champ-statut">Statut</label><select id="champ-statut" name="statut">' + M.STATUTS.map(function (s) {
      return '<option value="' + s.cle + '"' + (s.cle === f.statut ? ' selected' : '') + '>' + esc(s.libelle) + '</option>';
    }).join('') + '</select></div>';

    module.champs.forEach(function (c) {
      var v = f[c.cle];
      if (v == null) v = (c.type === 'references' || c.type === 'images' || c.type === 'couleurs') ? [] : '';
      html += '<div class="champ">' + champHTML(c, v) + '</div>';
    });

    if (existe) {
      var entrantes = M.referencesEntrantes(etat, module.id, f.id);
      if (entrantes.length) {
        html += '<div class="utilise-dans"><strong>Utilisé dans :</strong> ' + entrantes.map(function (r) {
          return '<a data-action="ouvrir" data-module="' + r.module + '" data-id="' + esc(r.fiche.id) + '">' + esc(r.fiche.titre) + '</a> (' + esc(M.trouverModule(r.module).titre) + ')';
        }).join(' · ') + '</div>';
      }
      html += '<div class="utilise-dans">Créée le ' + esc(dateFr(f.creeLe)) + ' · modifiée le ' + esc(dateFr(f.modifieLe)) + '</div>';
    }

    html += '</div><div class="dlg-pied">' +
      (existe ? '<button type="button" class="btn danger" data-action="supprimer">Supprimer</button>' : '') +
      '<span class="espace"></span><button type="button" class="btn" data-action="fermer">Annuler</button>' +
      '<button type="submit" class="btn primaire">Enregistrer</button></div></form>';
    el.fenetre.innerHTML = html;
  }

  // Recopie dans le brouillon ce qui est saisi dans le formulaire.
  function lireFormulaire() {
    var form = document.getElementById('formulaire-fiche');
    if (!form || !ui.brouillon) return;
    var module = M.trouverModule(ui.brouillonModule);
    var b = ui.brouillon;
    b.statut = form.elements.statut.value;
    module.champs.forEach(function (c) {
      var nom = 'c_' + c.cle;
      if (c.type === 'references') {
        b[c.cle] = Array.prototype.slice.call(form.querySelectorAll('input[name="' + nom + '"]:checked')).map(function (i) { return i.value; });
      } else if (c.type === 'images' || c.type === 'image' || c.type === 'audio') {
        // déjà tenus à jour dans le brouillon
      } else if (c.type === 'couleurs') {
        b[c.cle] = lignes(form.elements[nom].value);
      } else if (c.type === 'nombre') {
        var n = form.elements[nom].value;
        b[c.cle] = n === '' ? '' : Number(n);
      } else if (c.type === 'montant') {
        var m = String(form.elements[nom].value).replace(',', '.');
        b[c.cle] = m === '' ? '' : Math.round(Number(m) * 100) / 100;
      } else if (form.elements[nom]) {
        b[c.cle] = form.elements[nom].value;
      }
    });
  }

  function enregistrerFiche() {
    lireFormulaire();
    var b = ui.brouillon;
    var module = M.trouverModule(ui.brouillonModule);
    if (!String(b.titre || '').trim()) { toast('Le champ « ' + module.champs[0].libelle + ' » est obligatoire.', true); return; }
    var couleursInvalides = module.champs.some(function (c) { return c.type === 'couleurs' && (b[c.cle] || []).some(function (x) { return !M.estCouleur(x); }); });
    if (couleursInvalides) { toast('Une couleur n\'est pas au format #RRGGBB (par exemple #1B2A4A).', true); return; }
    try {
      if (b.id && M.trouverFiche(etat, module.id, b.id)) {
        M.modifierFiche(etat, module.id, b.id, b);
        toast('Fiche enregistrée.');
      } else {
        M.ajouterFiche(etat, module.id, b);
        toast('Fiche ajoutée.');
      }
    } catch (e) { toast(e.message, true); return; }
    sauver();
    el.fenetre.close();
    afficher();
  }

  function ajouterMedia(cle, src) {
    var module = M.trouverModule(ui.brouillonModule);
    var c = module.champs.filter(function (x) { return x.cle === cle; })[0];
    var genre = c.type === 'audio' ? 'audio' : 'image';
    if (!M.estMediaSur(src, genre)) { toast(genre === 'audio' ? 'Ce son n\'est pas accepté (adresse https:// ou fichier audio).' : 'Cette image n\'est pas acceptée (adresse https:// ou fichier PNG, JPEG, GIF, WebP).', true); return; }
    lireFormulaire();
    if (c.type === 'images') {
      ui.brouillon[cle] = (Array.isArray(ui.brouillon[cle]) ? ui.brouillon[cle] : []).concat(src);
    } else {
      ui.brouillon[cle] = src;
    }
    rendreFenetre();
  }

  function lireFichiersMedia(input) {
    var cle = input.getAttribute('data-champ');
    var fichiers = Array.prototype.slice.call(input.files || []);
    fichiers.forEach(function (fichier) {
      var audio = /^audio\//.test(fichier.type);
      var max = audio ? TAILLE_MAX_AUDIO : TAILLE_MAX_IMAGE;
      if (fichier.size > max) {
        toast('« ' + fichier.name + ' » est trop lourd (' + (fichier.size / 1048576).toFixed(1).replace('.', ',') + ' Mo). Déposez-le sur le Drive et collez son lien.', true);
        return;
      }
      var lecteur = new FileReader();
      lecteur.onload = function () { ajouterMedia(cle, String(lecteur.result)); };
      lecteur.onerror = function () { toast('Lecture du fichier impossible.', true); };
      lecteur.readAsDataURL(fichier);
    });
  }

  // ------------------------------------------------------------ Fenêtres du projet et des outils

  function ouvrirProjet() {
    var p = etat.projet;
    var champs = [['nom', 'Nom du jeu'], ['genre', 'Genre'], ['phase', 'Phase'], ['dureeCible', 'Durée cible'], ['moteur', 'Moteur'], ['resume', 'Résumé']];
    el.fenetre.innerHTML = '<form method="dialog" id="formulaire-projet"><div class="dlg-tete"><h3 id="fenetre-titre">Le projet</h3><button type="button" class="btn icone" data-action="fermer" aria-label="Fermer">✕</button></div><div class="dlg-corps">' +
      champs.map(function (c) {
        return '<div class="champ"><label for="p-' + c[0] + '">' + c[1] + '</label>' + (c[0] === 'resume'
          ? '<textarea id="p-' + c[0] + '" name="' + c[0] + '">' + esc(p[c[0]]) + '</textarea>'
          : '<input type="text" id="p-' + c[0] + '" name="' + c[0] + '" value="' + esc(p[c[0]]) + '">') + '</div>';
      }).join('') + '</div><div class="dlg-pied"><span class="espace"></span><button type="button" class="btn" data-action="fermer">Annuler</button><button type="submit" class="btn primaire">Enregistrer</button></div></form>';
    el.fenetre.showModal();
  }

  function ouvrirOutils() {
    var texte = etat.outils.map(function (o) { return o.nom + ' | ' + o.url; }).join('\n');
    el.fenetre.innerHTML = '<form method="dialog" id="formulaire-outils"><div class="dlg-tete"><h3 id="fenetre-titre">Accès aux outils</h3><button type="button" class="btn icone" data-action="fermer" aria-label="Fermer">✕</button></div><div class="dlg-corps">' +
      '<div class="champ"><label for="outils-texte">Un outil par ligne : Nom | adresse</label><textarea id="outils-texte" name="outils" style="min-height:200px">' + esc(texte) + '</textarea>' +
      '<div class="aide">Seules les adresses commençant par https:// sont affichées.</div></div></div>' +
      '<div class="dlg-pied"><span class="espace"></span><button type="button" class="btn" data-action="fermer">Annuler</button><button type="submit" class="btn primaire">Enregistrer</button></div></form>';
    el.fenetre.showModal();
  }

  // ------------------------------------------------------------ Sauvegardes automatiques

  function heureFr(iso) {
    if (!iso) return 'jamais';
    var d = new Date(iso);
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  // Contenu de la carte « Sauvegardes et données » du tableau de bord.
  function blocGithub() {
    var G = window.SPGithub;
    if (!G) return '';
    var g = G.etat();
    var html = '<h3>Sauvegarde en ligne sur GitHub</h3>';
    if (!g.connecte) {
      return html + '<p>Pas encore connectée. Une fois connectée, chaque modification est enregistrée 30 secondes plus tard dans votre dépôt privé GitHub, avec tout l\'historique, et vous retrouvez les mêmes données sur tous vos appareils.</p>' +
        '<div class="outils" style="margin:0"><button type="button" class="btn primaire" data-action="github-connecter">Connecter GitHub…</button></div>';
    }
    html += '<p>' + (g.mode === 'connecte' ? '<span class="ok">✓ Connectée.</span> ' : '') + 'Dépôt <strong>' + esc(g.proprietaire + '/' + g.depot) + '</strong>, branche <code>' + esc(g.branche) + '</code>, fichier <code>' + esc(g.chemin) + '</code>. ' +
      'Dernier envoi : ' + esc(heureFr(g.dernierEnvoi)) + (g.enAttente && g.mode === 'connecte' ? ' (modifications en attente d\'envoi)' : '') + '.' +
      (g.memorise ? '' : ' La clé n\'est pas mémorisée : elle sera redemandée à la prochaine ouverture du navigateur.') + '</p>';
    if (g.mode === 'erreur') html += '<p class="etiquette alerte">' + esc(g.erreur) + '</p>';
    if (g.mode === 'conflit') html += '<p class="etiquette alerte">Les données ont changé ici et sur un autre appareil : choisissez lesquelles garder (bandeau en haut).</p>';
    html += '<div class="outils" style="margin:0"><button type="button" class="btn" data-action="github-envoyer">Envoyer maintenant</button>' +
      '<a class="btn" href="https://github.com/' + encodeURIComponent(g.proprietaire) + '/' + encodeURIComponent(g.depot) + '/commits/' + encodeURIComponent(g.branche) + '" target="_blank" rel="noopener">Historique sur GitHub ↗</a>' +
      '<button type="button" class="btn danger" data-action="github-deconnecter">Déconnecter</button></div>';
    return html;
  }

  function blocSauvegarde() {
    var S = window.SPSauvegarde;
    var html = blocGithub() + (window.SPGithub ? '<hr style="border:none;border-top:1px solid var(--bord);margin:18px 0">' : '');
    if (S) {
      var st = S.etat();
      html += '<h3>Sauvegarde automatique dans un dossier de l\'ordinateur</h3>';
      if (st.mode === 'actif') {
        html += '<p><span class="ok">✓ Active.</span> Chaque modification est enregistrée, 30 secondes plus tard, dans le dossier « ' + esc(st.nomDossier) + ' » : fichier <code>studio-pixel-manager-auto.json</code> et une copie datée par jour. Dernière écriture : ' + esc(heureFr(st.dernierDossier)) + '.</p>' +
          (st.erreur ? '<p class="etiquette alerte">Dernière tentative échouée : ' + esc(st.erreur) + '</p>' : '') +
          '<div class="outils" style="margin:0"><button type="button" class="btn" data-action="sauvegarder-maintenant">Sauvegarder maintenant</button>' +
          '<button type="button" class="btn" data-action="choisir-dossier">Changer de dossier…</button>' +
          '<button type="button" class="btn danger" data-action="arreter-dossier">Arrêter</button></div>';
      } else if (st.mode === 'a_reautoriser') {
        html += '<p>En pause : après un redémarrage, le navigateur demande de confirmer l\'accès au dossier « ' + esc(st.nomDossier) + ' ».</p>' +
          '<div class="outils" style="margin:0"><button type="button" class="btn primaire" data-action="reautoriser">Reprendre la sauvegarde automatique</button>' +
          '<button type="button" class="btn danger" data-action="arreter-dossier">Arrêter</button></div>';
      } else if (st.mode === 'aucun') {
        html += '<p>Pas encore activée. Choisissez une seule fois le dossier <strong>01_Pilotage</strong> du Drive (dans le Finder : <em>Google Drive › Mon Drive › Studio_Pixel › 01_Pilotage</em>). Le Manager y enregistrera ensuite chaque modification tout seul, et Google Drive pour ordinateur l\'enverra sur le Drive.</p>' +
          '<div class="outils" style="margin:0"><button type="button" class="btn primaire" data-action="choisir-dossier">Choisir le dossier de sauvegarde…</button></div>';
      } else {
        html += '<p>Ce navigateur (par exemple Safari) ne permet pas à une page d\'écrire dans un dossier. Les copies de secours ci-dessous restent automatiques ; pour mettre les données sur le Drive, utilisez « Exporter ». La sauvegarde automatique sur le Drive fonctionne avec Chrome ou Edge.</p>';
      }
      html += '<h3 style="margin-top:18px">Copies de secours dans ce navigateur</h3><p class="extrait" style="-webkit-line-clamp:unset">Automatiques : une copie par jour, les 14 derniers jours. Elles restent sur cet ordinateur et permettent de revenir en arrière.</p><div class="copies" id="liste-copies"><span class="aide">Chargement…</span></div>';
    }
    html += '<h3 style="margin-top:18px">Export manuel</h3><p class="extrait" style="-webkit-line-clamp:unset">Espace utilisé dans le navigateur : ' + (tailleStockage() / 1048576).toFixed(2).replace('.', ',') + ' Mo sur environ 5 Mo. Dernier export manuel : ' + esc(S ? heureFr(S.etat().dernierExport) : 'inconnu') + '.</p>' +
      '<div class="outils" style="margin:0"><button type="button" class="btn" data-action="exporter">⤓ Exporter (fichier JSON)</button><button type="button" class="btn" data-action="copier-donnees" title="Si le téléchargement ne marche pas : copie toutes les données, à coller dans un document">⧉ Copier les données</button><button type="button" class="btn" data-action="importer">⤒ Importer</button>' +
      '<button type="button" class="btn danger" data-action="reinitialiser">Revenir aux données de départ</button></div>';
    return html;
  }

  function remplirCopies() {
    var zone = document.getElementById('liste-copies');
    if (!zone || !window.SPSauvegarde) return;
    window.SPSauvegarde.listerCopies().then(function (copies) {
      zone = document.getElementById('liste-copies');
      if (!zone) return;
      zone.innerHTML = copies.length ? copies.map(function (c) {
        return '<div class="copie"><span>' + esc(dateFr(c.jour)) + ' · ' + esc(heureFr(c.date).split(' à ')[1] || '') + ' · ' + Math.max(1, Math.round(c.taille / 1024)) + ' Ko</span>' +
          '<button type="button" class="btn petit" data-action="restaurer-copie" data-jour="' + esc(c.jour) + '">Restaurer</button></div>';
      }).join('') : '<span class="aide">Aucune copie pour l\'instant.</span>';
    });
  }

  // Met à jour le bandeau d'alerte (toutes les pages) et la carte du tableau de bord.
  function majSauvegarde() {
    var S = window.SPSauvegarde;
    if (!S) return;
    var st = S.etat();
    var b = document.getElementById('bandeau');
    var html = '';
    var g = window.SPGithub ? window.SPGithub.etat() : null;
    if (g && g.connecte && g.mode === 'conflit') {
      html = '<span class="texte">Les données ont été modifiées ici et sur un autre appareil. Lesquelles garder ?</span>' +
        '<button type="button" class="btn primaire petit" data-action="github-charger">Celles de GitHub</button>' +
        '<button type="button" class="btn petit" data-action="github-garder">Celles de cet appareil</button>';
    } else if (g && g.connecte && g.mode === 'erreur') {
      html = '<span class="texte">Sauvegarde GitHub impossible : ' + esc(g.erreur) + '</span>' +
        '<button type="button" class="btn petit" data-action="github-envoyer">Réessayer</button>';
    } else if (g && !g.connecte && MODE_PUBLIC) {
      html = '<span class="texte">Version en ligne : connectez votre dépôt GitHub privé pour charger et sauvegarder vos données.</span>' +
        '<button type="button" class="btn primaire petit" data-action="github-connecter">Connecter GitHub…</button>';
    } else if (g && g.connecte) {
      html = '';
    } else if (st.mode === 'a_reautoriser') {
      html = '<span class="texte">La sauvegarde automatique est en pause : le navigateur demande de confirmer l\'accès au dossier.</span>' +
        '<button type="button" class="btn primaire petit" data-action="reautoriser">Reprendre</button>';
    } else if (st.rappel && !(g && g.connecte)) {
      html = '<span class="texte">' + (st.joursSansSauvegarde === null ? 'Vos données ne sont encore sauvegardées que dans ce navigateur.' : 'Aucune sauvegarde hors de ce navigateur depuis ' + st.joursSansSauvegarde + ' jours.') + '</span>' +
        (st.mode === 'aucun' ? '<button type="button" class="btn primaire petit" data-action="choisir-dossier">Activer la sauvegarde automatique</button>' : '') +
        '<button type="button" class="btn petit" data-action="exporter">Exporter maintenant</button>';
    }
    b.innerHTML = html;
    b.classList.toggle('cache', !html);
    if (st.mode === 'actif') el.etatSauvegarde.title = 'Sauvegarde automatique active : ' + st.nomDossier;
    var bloc = document.getElementById('bloc-sauvegarde');
    if (bloc) { bloc.innerHTML = blocSauvegarde(); remplirCopies(); }
  }

  function erreurSauvegarde(e) {
    if (e && e.name === 'AbortError') return; // fenêtre de choix fermée sans choisir
    toast((e && e.message) || 'La sauvegarde a échoué.', true);
  }

  // ------------------------------------------------------------ Sauvegarde GitHub

  // Remplace les données de l'appareil par celles venues de GitHub.
  function appliquerDistant(distant) {
    var nouvel;
    try { nouvel = M.importerJSON(distant.texte); } catch (e) { toast('Données GitHub illisibles : ' + e.message, true); return false; }
    etat = nouvel;
    sauver(true);
    window.SPGithub.marquerAJour(distant.sha);
    appliquerApparence();
    afficher();
    return true;
  }

  // Les deux côtés ont changé : la directrice choisit.
  function resoudreConflit(distant) {
    return confirmer('Les données ont été modifiées sur cet appareil ET en ligne (sur un autre appareil).\n\nLesquelles garder ? L\'autre version reste récupérable : dans l\'historique GitHub, ou dans les copies de secours de ce navigateur.', 'Celles de GitHub', 'Celles de cet appareil').then(function (github) {
      if (github) {
        return (distant ? Promise.resolve(distant) : window.SPGithub.lireDistant()).then(function (d) {
          if (window.SPSauvegarde) window.SPSauvegarde.sauvegarderMaintenant();
          if (d && appliquerDistant(d)) toast('Données de GitHub chargées.');
        });
      }
      return window.SPGithub.forcerEnvoi().then(function () { toast('Données de cet appareil envoyées sur GitHub.'); });
    }).catch(function (e) { toast(e.message, true); });
  }

  function ouvrirConnexionGithub() {
    var d = window.SPGithub.DEFAUTS;
    var g = window.SPGithub.etat();
    el.fenetre.innerHTML = '<form method="dialog" id="formulaire-github" autocomplete="off"><div class="dlg-tete"><h3 id="fenetre-titre">Connecter GitHub</h3><button type="button" class="btn icone" data-action="fermer" aria-label="Fermer">✕</button></div><div class="dlg-corps">' +
      '<p class="extrait" style="-webkit-line-clamp:unset">Les données seront enregistrées dans votre dépôt <strong>privé</strong>, sur une branche à part. La clé reste dans ce navigateur : elle n\'est envoyée qu\'à GitHub.</p>' +
      '<div class="champ"><label for="gh-jeton">Clé GitHub (fine-grained token)</label><input type="password" id="gh-jeton" name="jeton" required autocomplete="off" spellcheck="false" placeholder="github_pat_…">' +
      '<div class="aide">Pas encore de clé ? <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">La créer sur GitHub ↗</a> : accès au seul dépôt du studio, droit « Contents » en « Read and write ». Le guide du Manager détaille chaque case.</div></div>' +
      '<div class="champ"><label><input type="checkbox" name="memoriser" checked> Mémoriser la clé sur cet appareil (décochez sur un ordinateur partagé)</label></div>' +
      '<details><summary>Réglages avancés</summary><div class="dlg-corps" style="padding:12px 0 0">' +
      '<div class="champ"><label for="gh-prop">Propriétaire</label><input type="text" id="gh-prop" name="proprietaire" value="' + esc(g.proprietaire || d.proprietaire) + '"></div>' +
      '<div class="champ"><label for="gh-depot">Dépôt privé</label><input type="text" id="gh-depot" name="depot" value="' + esc(g.depot || d.depot) + '"></div>' +
      '<div class="champ"><label for="gh-branche">Branche des données</label><input type="text" id="gh-branche" name="branche" value="' + esc(g.branche || d.branche) + '"></div>' +
      '</div></details></div>' +
      '<div class="dlg-pied"><span class="espace"></span><button type="button" class="btn" data-action="fermer">Annuler</button><button type="submit" class="btn primaire">Connecter</button></div></form>';
    el.fenetre.showModal();
    document.getElementById('gh-jeton').focus();
  }

  function connecterGithub(form) {
    var bouton = form.querySelector('[type=submit]');
    bouton.disabled = true;
    bouton.textContent = 'Connexion…';
    window.SPGithub.connecter({
      jeton: form.elements.jeton.value,
      memoriser: form.elements.memoriser.checked,
      proprietaire: form.elements.proprietaire.value,
      depot: form.elements.depot.value,
      branche: form.elements.branche.value
    }).then(function (distant) {
      el.fenetre.close();
      if (!distant) {
        return window.SPGithub.envoyer().then(function () { toast('GitHub connecté : vos données y sont sauvegardées.'); });
      }
      if (MODE_PUBLIC && aucuneFiche()) {
        if (appliquerDistant(distant)) toast('GitHub connecté : vos données sont chargées.');
        return;
      }
      return resoudreConflit(distant);
    }).catch(function (e) {
      bouton.disabled = false;
      bouton.textContent = 'Connecter';
      toast(e.message, true);
    });
  }

  function resoudreConflitChoix(github) {
    if (github) {
      window.SPGithub.lireDistant().then(function (d) {
        if (window.SPSauvegarde) window.SPSauvegarde.sauvegarderMaintenant();
        if (d && appliquerDistant(d)) toast('Données de GitHub chargées.');
      }).catch(function (e) { toast(e.message, true); });
    } else {
      window.SPGithub.forcerEnvoi().then(function () { toast('Données de cet appareil envoyées sur GitHub.'); }, function (e) { toast(e.message, true); });
    }
  }

  function aucuneFiche() {
    return M.MODULES.every(function (m) { return !etat.collections[m.id].length; });
  }

  // ------------------------------------------------------------ Confirmation

  // Fenêtre de confirmation intégrée à la page (les boîtes natives du navigateur
  // sont bloquées dans certains affichages, comme l'aperçu Claude).
  function confirmer(message, libelleOui, libelleNon) {
    return new Promise(function (resoudre) {
      var d = document.getElementById('confirmation');
      d.innerHTML = '<form method="dialog"><div class="dlg-corps"><p style="margin:0;white-space:pre-line">' + esc(message) + '</p></div>' +
        '<div class="dlg-pied"><span class="espace"></span><button type="button" class="btn" data-confirmer="non">' + esc(libelleNon || 'Annuler') + '</button>' +
        '<button type="button" class="btn primaire" data-confirmer="oui">' + esc(libelleOui || 'Confirmer') + '</button></div></form>';
      var fini = false;
      function terminer(reponse) {
        if (fini) return;
        fini = true;
        if (d.open) d.close();
        resoudre(reponse);
      }
      d.onclick = function (e) {
        var b = e.target.closest('[data-confirmer]');
        if (b) terminer(b.getAttribute('data-confirmer') === 'oui');
      };
      d.onclose = function () { terminer(false); };
      d.showModal();
      d.querySelector('[data-confirmer="non"]').focus();
    });
  }

  // ------------------------------------------------------------ Import, export, réinitialisation

  function exporter() {
    var texte = M.exporterJSON(etat);
    var blob = new Blob([texte], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'studio-pixel-manager-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    if (window.SPSauvegarde) window.SPSauvegarde.noterExportManuel();
    toast('Export téléchargé. Rangez-le dans le Drive (01_Pilotage).');
  }

  function importer(fichier) {
    var lecteur = new FileReader();
    lecteur.onload = function () {
      var nouvel;
      try { nouvel = M.importerJSON(String(lecteur.result)); } catch (e) { toast(e.message, true); return; }
      confirmer('Remplacer toutes les données actuelles par celles du fichier « ' + fichier.name + ' » ?\n\nConseil : exportez d\'abord les données actuelles.', 'Remplacer').then(function (oui) {
        if (!oui) return;
        etat = nouvel;
        sauver();
        appliquerApparence();
        afficher();
        toast('Données importées.');
      });
    };
    lecteur.onerror = function () { toast('Lecture du fichier impossible.', true); };
    lecteur.readAsText(fichier);
  }

  function reinitialiser() {
    confirmer('Revenir aux données de départ ? Toutes vos modifications seront effacées de ce navigateur.\n\nConseil : exportez d\'abord vos données.', 'Effacer et revenir au départ').then(function (oui) {
      if (!oui) return;
      etat = M.creerEtat(window.SPDonneesInitiales);
      sauver();
      appliquerApparence();
      afficher();
      toast('Données de départ rechargées.');
    });
  }

  function copier(texte) {
    function secours() {
      var zone = document.createElement('textarea');
      zone.value = texte;
      zone.style.position = 'fixed';
      zone.style.opacity = '0';
      document.body.appendChild(zone);
      zone.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      zone.remove();
      toast(ok ? 'Copié.' : 'Copie impossible : sélectionnez le texte à la main.', !ok);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(texte).then(function () { toast('Copié.'); }, secours);
    } else { secours(); }
  }

  // ------------------------------------------------------------ Événements

  function surClic(e) {
    // Sur téléphone, un clic en dehors du menu ouvert le referme.
    if (el.app.classList.contains('menu-ouvert') && !e.target.closest('#menu') && !e.target.closest('#btn-menu')) {
      el.app.classList.remove('menu-ouvert');
    }
    var cible = e.target.closest('[data-action]');
    if (!cible) return;
    var action = cible.getAttribute('data-action');
    var idModule = cible.getAttribute('data-module');
    var id = cible.getAttribute('data-id');

    switch (action) {
      case 'lien': case 'lecteur':
        e.stopPropagation(); return; // laisse le lien ou le lecteur fonctionner sans ouvrir la fiche
      case 'ouvrir':
        if (el.fenetre.open && !el.fenetre.contains(cible)) return;
        ouvrirFiche(idModule, id); break;
      case 'nouveau':
        ouvrirFiche(idModule, null); break;
      case 'statut':
        ui.statut = cible.getAttribute('data-statut'); afficher(); break;
      case 'comparer':
        e.preventDefault(); e.stopPropagation();
        var pos = ui.comparaison.indexOf(id);
        if (pos !== -1) ui.comparaison.splice(pos, 1);
        else { ui.comparaison.push(id); if (ui.comparaison.length > 2) ui.comparaison.shift(); }
        afficher(); break;
      case 'fin-comparaison':
        ui.comparaison = []; afficher(); break;
      case 'copier':
        e.stopPropagation();
        var f = M.trouverFiche(etat, idModule, id);
        if (f) copier(f[cible.getAttribute('data-champ')] || '');
        break;
      case 'copier-champ':
        var zone = el.fenetre.querySelector('[name="c_' + cible.getAttribute('data-champ') + '"]');
        if (zone) copier(zone.value);
        break;
      case 'fermer':
        el.fenetre.close(); break;
      case 'supprimer':
        var mod = M.trouverModule(ui.brouillonModule);
        var aSupprimer = ui.brouillon;
        confirmer('Supprimer « ' + aSupprimer.titre + ' » ? Les liens vers cette fiche seront retirés.', 'Supprimer').then(function (oui) {
          if (!oui) return;
          M.supprimerFiche(etat, mod.id, aSupprimer.id);
          ui.comparaison = ui.comparaison.filter(function (x) { return x !== aSupprimer.id; });
          sauver(); el.fenetre.close(); afficher(); toast('Fiche supprimée.');
        });
        break;
      case 'retirer-media':
        lireFormulaire();
        var cle = cible.getAttribute('data-champ');
        var idx = Number(cible.getAttribute('data-index'));
        if (Array.isArray(ui.brouillon[cle])) ui.brouillon[cle].splice(idx, 1); else ui.brouillon[cle] = '';
        rendreFenetre(); break;
      case 'ajouter-url-media':
        var champUrl = el.fenetre.querySelector('[data-role="url-media"][data-champ="' + cible.getAttribute('data-champ') + '"]');
        if (champUrl && champUrl.value.trim()) ajouterMedia(cible.getAttribute('data-champ'), champUrl.value.trim());
        break;
      case 'modifier-projet': ouvrirProjet(); break;
      case 'modifier-outils': ouvrirOutils(); break;
      case 'exporter': exporter(); break;
      case 'copier-donnees': copier(M.exporterJSON(etat)); break;
      case 'github-connecter': ouvrirConnexionGithub(); break;
      case 'github-envoyer':
        window.SPGithub.envoyer().then(function (ok) { if (ok) toast('Envoyé sur GitHub.'); }, function (e) { if (!e.conflit) toast(e.message, true); }); break;
      case 'github-charger': resoudreConflitChoix(true); break;
      case 'github-garder': resoudreConflitChoix(false); break;
      case 'github-deconnecter':
        confirmer('Déconnecter GitHub sur cet appareil ? La clé est effacée de ce navigateur. Les données déjà sauvegardées restent sur GitHub.', 'Déconnecter').then(function (oui) {
          if (oui) { window.SPGithub.deconnecter(); toast('GitHub déconnecté sur cet appareil.'); }
        }); break;
      case 'choisir-dossier':
        window.SPSauvegarde.choisirDossier().then(function () { toast('Sauvegarde automatique activée.'); }, erreurSauvegarde); break;
      case 'reautoriser':
        window.SPSauvegarde.reautoriser().then(function (p) { if (p === 'actif') toast('Sauvegarde automatique reprise.'); }, erreurSauvegarde); break;
      case 'sauvegarder-maintenant':
        window.SPSauvegarde.sauvegarderMaintenant().then(function () { toast('Sauvegarde faite.'); }, erreurSauvegarde); break;
      case 'arreter-dossier':
        confirmer('Arrêter la sauvegarde automatique dans le dossier ? Les fichiers déjà écrits restent en place.', 'Arrêter').then(function (oui) {
          if (oui) window.SPSauvegarde.arreterDossier().then(function () { toast('Sauvegarde automatique arrêtée.'); });
        }); break;
      case 'restaurer-copie':
        var j = cible.getAttribute('data-jour');
        // La copie d'aujourd'hui serait écrasée par une sauvegarde préalable : on ne la fait que pour un jour passé.
        var aujourdhui = j === window.SPSauvegarde.jour();
        confirmer('Remplacer les données actuelles par la copie du ' + dateFr(j) + ' ?' + (aujourdhui ? '' : '\n\nLes données actuelles sont d\'abord gardées dans la copie d\'aujourd\'hui.'), 'Restaurer').then(function (oui) {
          if (!oui) return;
          var texteCopie;
          window.SPSauvegarde.lireCopie(j)
            .then(function (t) { texteCopie = t; return aujourdhui ? null : window.SPSauvegarde.sauvegarderMaintenant(); })
            .then(function () { return texteCopie; })
            .then(function (texte) {
              etat = M.importerJSON(texte);
              sauver(); appliquerApparence(); afficher();
              toast('Copie du ' + dateFr(j) + ' restaurée.');
            })
            .catch(function (e) { toast(e.message, true); });
        }); break;
      case 'importer': el.fichierImport.click(); break;
      case 'reinitialiser': reinitialiser(); break;
    }
  }

  function surSoumission(e) {
    e.preventDefault();
    var form = e.target;
    if (form.id === 'formulaire-fiche') { enregistrerFiche(); return; }
    if (form.id === 'formulaire-github') { connecterGithub(form); return; }
    if (form.id === 'formulaire-projet') {
      ['nom', 'genre', 'phase', 'dureeCible', 'moteur', 'resume'].forEach(function (k) { etat.projet[k] = form.elements[k].value.trim(); });
      sauver(); el.fenetre.close(); afficher(); toast('Projet enregistré.');
      return;
    }
    if (form.id === 'formulaire-outils') {
      etat.outils = lignes(form.elements.outils.value).map(function (l) {
        var morceaux = l.split('|');
        var url = (morceaux.pop() || '').trim();
        var nom = morceaux.join('|').trim() || url;
        return { nom: nom, url: url };
      }).filter(function (o) { return o.url; });
      sauver(); el.fenetre.close(); afficher(); toast('Outils enregistrés.');
    }
  }

  function brancherEvenements() {
    document.addEventListener('click', surClic);
    el.fenetre.addEventListener('submit', surSoumission);

    // Entrée ou Espace sur une carte = clic (accessibilité clavier).
    document.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"][data-action]')) {
        e.preventDefault();
        e.target.click();
      }
    });

    el.contenu.addEventListener('input', function (e) {
      if (e.target.getAttribute('data-role') === 'recherche-module') {
        ui.texteModule = e.target.value;
        var position = e.target.selectionStart;
        afficher();
        var champ = el.contenu.querySelector('[data-role="recherche-module"]');
        if (champ) { champ.focus(); champ.setSelectionRange(position, position); }
      }
    });
    el.contenu.addEventListener('change', function (e) {
      if (e.target.getAttribute('data-role') === 'plafond') {
        var v = Number(String(e.target.value).replace(',', '.'));
        if (!isFinite(v) || v < 0) { toast('Le plafond doit être un nombre positif.', true); afficher(); return; }
        etat.reglages.plafondAdditionnel = v;
        sauver(); afficher();
      }
    });

    el.fenetre.addEventListener('change', function (e) {
      if (e.target.getAttribute('data-role') === 'fichier-media') lireFichiersMedia(e.target);
    });
    el.fenetre.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.getAttribute('data-role') === 'url-media') {
        e.preventDefault();
        if (e.target.value.trim()) ajouterMedia(e.target.getAttribute('data-champ'), e.target.value.trim());
      }
    });
    // Un clic sur le fond sombre ferme la fenêtre.
    el.fenetre.addEventListener('click', function (e) { if (e.target === el.fenetre) el.fenetre.close(); });
    el.fenetre.addEventListener('close', function () { document.body.appendChild(el.toasts); });

    el.recherche.addEventListener('input', function () {
      ui.recherche = el.recherche.value;
      afficher();
    });

    document.getElementById('btn-menu').addEventListener('click', function () {
      if (window.matchMedia('(max-width: 820px)').matches) {
        el.app.classList.toggle('menu-ouvert');
      } else {
        etat.reglages.menuReplie = !etat.reglages.menuReplie;
        appliquerApparence(); sauver();
      }
    });
    document.getElementById('btn-theme').addEventListener('click', function () {
      etat.reglages.theme = etat.reglages.theme === 'clair' ? 'sombre' : 'clair';
      appliquerApparence(); sauver();
    });
    document.getElementById('btn-exporter').addEventListener('click', exporter);
    document.getElementById('btn-importer').addEventListener('click', function () { el.fichierImport.click(); });
    el.fichierImport.addEventListener('change', function () {
      if (el.fichierImport.files[0]) importer(el.fichierImport.files[0]);
      el.fichierImport.value = '';
    });
    el.nav.addEventListener('click', function (e) {
      var a = e.target.closest('a');
      if (a && a.getAttribute('href') === location.hash) { e.preventDefault(); aller(a.getAttribute('href').slice(2)); }
      else if (a) { ui.recherche = ''; el.recherche.value = ''; }
    });
    window.addEventListener('hashchange', changerModule);
  }

  // ------------------------------------------------------------ Démarrage

  etat = charger();
  appliquerApparence();
  lireAdresse();
  brancherEvenements();
  afficher();
  if (!lireStockage()) sauver();
  else el.etatSauvegarde.textContent = 'Données chargées';
  if (window.SPGithub) {
    window.SPGithub.demarrer({
      fournisseur: function () { return M.exporterJSON(etat); },
      surChangement: majSauvegarde
    }).then(function (r) {
      if (r.action === 'charger') { if (appliquerDistant(r.distant)) toast('Données mises à jour depuis GitHub.'); }
      else if (r.action === 'envoyer') window.SPGithub.envoyer().catch(function () { majSauvegarde(); });
      else if (r.action === 'conflit') resoudreConflit(r.distant);
      majSauvegarde();
    });
  }
  if (window.SPSauvegarde) {
    window.SPSauvegarde.demarrer({
      fournisseur: function () { return M.exporterJSON(etat); },
      surChangement: majSauvegarde
    }).catch(function () { majSauvegarde(); });
  }
})();
