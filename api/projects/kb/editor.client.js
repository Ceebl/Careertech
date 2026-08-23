/* Rich text editing for the entry form.
 *
 * Progressive: if this script fails to load, the plain textarea underneath
 * still works and still accepts HTML, so the form is never broken.
 */
(function () {
  'use strict';

  var form = document.querySelector('form.editor');
  var textarea = form && form.querySelector('textarea[name="body"]');
  if (!form || !textarea) return;

  /* ---------------------------------------------------------------- build */

  var wrap = document.createElement('div');
  wrap.className = 'rte';

  var bar = document.createElement('div');
  bar.className = 'rte-bar';

  var canvas = document.createElement('div');
  canvas.className = 'rte-canvas';
  canvas.contentEditable = 'true';
  canvas.innerHTML = textarea.value;

  var status = document.createElement('div');
  status.className = 'rte-status';
  status.setAttribute('aria-live', 'polite');

  textarea.classList.add('rte-source');
  textarea.hidden = true;

  textarea.parentNode.insertBefore(wrap, textarea);
  wrap.appendChild(bar);
  wrap.appendChild(canvas);
  wrap.appendChild(textarea);
  wrap.appendChild(status);

  /* -------------------------------------------------------------- toolbar */

  var BUTTONS = [
    ['Bold', 'B', function () { exec('bold'); }, 'font-weight:700'],
    ['Italic', 'I', function () { exec('italic'); }, 'font-style:italic'],
    ['Heading', 'H2', function () { block('h2'); }, ''],
    ['Subheading', 'H3', function () { block('h3'); }, ''],
    ['Bulleted list', '• List', function () { exec('insertUnorderedList'); }, ''],
    ['Numbered list', '1. List', function () { exec('insertOrderedList'); }, ''],
    ['Quote', 'Quote', function () { block('blockquote'); }, ''],
    ['Code block', '</>', function () { block('pre'); }, 'font-family:monospace'],
    ['Link', 'Link', addLink, ''],
    ['Insert image', 'Image', pickFile, ''],
    ['Clear formatting', 'Clear', function () { exec('removeFormat'); }, ''],
  ];

  BUTTONS.forEach(function (spec) {
    var b = document.createElement('button');
    b.type = 'button';
    b.title = spec[0];
    b.setAttribute('aria-label', spec[0]);
    b.textContent = spec[1];
    if (spec[3]) b.setAttribute('style', spec[3]);
    b.addEventListener('click', function (e) { e.preventDefault(); spec[2](); });
    bar.appendChild(b);
  });

  var toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'rte-toggle';
  toggle.textContent = 'HTML';
  toggle.title = 'Edit the HTML directly';
  bar.appendChild(toggle);

  var sourceMode = false;
  toggle.addEventListener('click', function (e) {
    e.preventDefault();
    sourceMode = !sourceMode;
    if (sourceMode) {
      textarea.value = canvas.innerHTML;
      textarea.hidden = false;
      canvas.hidden = true;
      toggle.classList.add('on');
      say('Editing HTML directly. Paste iframes here.');
    } else {
      canvas.innerHTML = textarea.value;
      textarea.hidden = true;
      canvas.hidden = false;
      toggle.classList.remove('on');
      say('');
    }
  });

  function exec(command, value) {
    canvas.focus();
    try { document.execCommand(command, false, value || null); } catch (err) { /* ignore */ }
  }

  function block(tag) {
    exec('formatBlock', '<' + tag + '>');
  }

  function addLink() {
    var url = window.prompt('Link address', 'https://');
    if (url) exec('createLink', url);
  }

  /* --------------------------------------------------------------- upload */

  function sync() {
    if (!sourceMode) textarea.value = canvas.innerHTML;
  }

  function say(message, isError) {
    status.textContent = message || '';
    status.className = 'rte-status' + (isError ? ' error' : '');
  }

  function insertImage(url, alt) {
    var img = '<img src="' + url + '" alt="' + (alt || '').replace(/"/g, '') + '">';
    canvas.focus();
    try {
      document.execCommand('insertHTML', false, img);
    } catch (err) {
      canvas.insertAdjacentHTML('beforeend', img);
    }
    sync();
  }

  function upload(file) {
    if (!file || file.size === 0) return;
    if (file.size > 15 * 1024 * 1024) {
      say('That file is over the 15MB limit.', true);
      return;
    }
    say('Uploading ' + (file.name || 'image') + '...');

    fetch('/kb/upload', {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw new Error(data.error || 'Upload failed');
          return data;
        });
      })
      .then(function (data) {
        insertImage(data.url, file.name);
        say('');
      })
      .catch(function (err) { say(err.message, true); });
  }

  function pickFile() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/gif,image/webp';
    input.addEventListener('change', function () {
      if (input.files && input.files[0]) upload(input.files[0]);
    });
    input.click();
  }

  // Paste a screenshot straight in.
  canvas.addEventListener('paste', function (e) {
    var items = (e.clipboardData && e.clipboardData.items) || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].kind === 'file' && items[i].type.indexOf('image/') === 0) {
        e.preventDefault();
        upload(items[i].getAsFile());
        return;
      }
    }
  });

  // Or drag one in from the desktop.
  canvas.addEventListener('dragover', function (e) {
    if (e.dataTransfer && e.dataTransfer.types.indexOf('Files') !== -1) {
      e.preventDefault();
      canvas.classList.add('drop');
    }
  });
  canvas.addEventListener('dragleave', function () { canvas.classList.remove('drop'); });
  canvas.addEventListener('drop', function (e) {
    var files = e.dataTransfer && e.dataTransfer.files;
    if (!files || !files.length) return;
    e.preventDefault();
    canvas.classList.remove('drop');
    for (var i = 0; i < files.length; i++) upload(files[i]);
  });

  /* ----------------------------------------------------------------- save */

  // The textarea is what actually gets submitted. Keep it current as you type
  // rather than only copying on submit -- a submit that skips the event (a
  // script, an extension) would otherwise silently save an empty entry.
  canvas.addEventListener('input', sync);
  form.addEventListener('submit', sync);
  sync();
}());
