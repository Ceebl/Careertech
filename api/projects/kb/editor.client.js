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

  /* ------------------------------------------------------------ link picker */

  var picker = document.createElement('div');
  picker.className = 'rte-picker';
  picker.hidden = true;
  picker.innerHTML =
    '<input type="text" class="rte-picker-input" placeholder="Search entries, or paste a web address">'
    + '<div class="rte-picker-results"></div>';
  wrap.insertBefore(picker, canvas);

  var pickerInput = picker.querySelector('.rte-picker-input');
  var pickerResults = picker.querySelector('.rte-picker-results');
  var savedRange = null;

  // Focus moves to the search box, which throws away the selection in the
  // editor. Remember where the cursor was so the link lands in the right place.
  function rememberSelection() {
    var sel = window.getSelection();
    savedRange = (sel && sel.rangeCount && canvas.contains(sel.anchorNode))
      ? sel.getRangeAt(0).cloneRange()
      : null;
  }

  function restoreSelection() {
    canvas.focus();
    if (!savedRange) return;
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);
  }

  function closePicker() {
    picker.hidden = true;
    pickerResults.innerHTML = '';
    pickerInput.value = '';
  }

  function applyLink(url, fallbackText) {
    restoreSelection();
    if (savedRange && savedRange.collapsed && fallbackText) {
      // Nothing selected, so insert the title as the link text.
      document.execCommand('insertHTML', false,
        '<a href="' + url + '">' + fallbackText.replace(/</g, '&lt;') + '</a>');
    } else {
      exec('createLink', url);
    }
    sync();
    closePicker();
  }

  function addLink() {
    rememberSelection();
    picker.hidden = false;
    pickerInput.focus();
    searchEntries('');
  }

  function chosenCategories() {
    return [].slice
      .call(form.querySelectorAll('input[name="categories"]:checked'))
      .map(function (box) { return Number(box.value); });
  }

  function renderResults(entries, typed) {
    pickerResults.innerHTML = '';
    var looksLikeUrl = /^(https?:\/\/|\/)/i.test(typed);

    if (looksLikeUrl) {
      addResult('Link to ' + typed, 'web address', function () {
        applyLink(typed, typed);
      });
    }

    entries.forEach(function (entry) {
      addResult(entry.title, entry.categories.join(', '), function () {
        applyLink(entry.url, entry.title);
      });
    });

    if (typed && !looksLikeUrl) {
      addResult('Create "' + typed + '"', 'new entry', function () {
        createAndLink(typed);
      });
    }

    if (!pickerResults.children.length) {
      addResult('Type to search entries', '', null);
    }
  }

  function addResult(label, note, onPick) {
    var row = document.createElement('button');
    row.type = 'button';
    row.className = 'rte-picker-row';
    row.innerHTML = '<span>' + label.replace(/</g, '&lt;') + '</span>'
      + (note ? '<span class="rte-picker-note">' + note.replace(/</g, '&lt;') + '</span>' : '');
    if (onPick) {
      row.addEventListener('click', function (e) { e.preventDefault(); onPick(); });
    } else {
      row.disabled = true;
    }
    pickerResults.appendChild(row);
  }

  function searchEntries(typed) {
    fetch('/kb/entries.json?q=' + encodeURIComponent(typed))
      .then(function (r) { return r.json(); })
      .then(function (data) { renderResults(data.entries || [], typed); })
      .catch(function () { renderResults([], typed); });
  }

  function createAndLink(title) {
    var categoryIds = chosenCategories();
    fetch('/kb/quick-entry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title, categoryIds: categoryIds }),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw new Error(data.error || 'Could not create the entry');
          return data;
        });
      })
      .then(function (data) {
        applyLink(data.url, data.title);
        say('Created "' + data.title + '" and linked to it.');
      })
      .catch(function (err) { say(err.message, true); });
  }

  var searchTimer = null;
  pickerInput.addEventListener('input', function () {
    clearTimeout(searchTimer);
    var typed = pickerInput.value.trim();
    searchTimer = setTimeout(function () { searchEntries(typed); }, 200);
  });

  pickerInput.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { e.preventDefault(); closePicker(); canvas.focus(); }
    if (e.key === 'Enter') {
      e.preventDefault();
      var first = pickerResults.querySelector('.rte-picker-row:not([disabled])');
      if (first) first.click();
    }
  });

  /* --------------------------------------------------------------- upload */

  function sync() {
    if (!sourceMode) textarea.value = canvas.innerHTML;
  }

  function say(message, isError) {
    status.textContent = message || '';
    status.className = 'rte-status' + (isError ? ' error' : '');
  }

  function insertImage(url, alt, w, h) {
    var size = (w && h) ? ' width="' + w + '" height="' + h + '"' : '';
    var img = '<img src="' + url + '" alt="' + (alt || '').replace(/"/g, '') + '"'
      + size + ' loading="lazy" decoding="async">';
    canvas.focus();
    try {
      document.execCommand('insertHTML', false, img);
    } catch (err) {
      canvas.insertAdjacentHTML('beforeend', img);
    }
    sync();
  }

  var MAX_EDGE = 2000;          // plenty for a screenshot on any monitor
  var ALWAYS_FINE = 300 * 1024; // below this, resizing is not worth the loss

  function readable(bytes) {
    return bytes > 1048576
      ? (bytes / 1048576).toFixed(1) + 'MB'
      : Math.round(bytes / 1024) + 'KB';
  }

  /*
   * Shrink oversized images before they leave the device.
   *
   * A phone screenshot or photo is several megabytes, which is slow to upload
   * on mobile data and slow to load afterwards. GIFs are left alone -- redrawing
   * one through a canvas would flatten it to a single still frame.
   */
  function shrink(file) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var img = new Image();

      // If the image cannot be read, send it untouched rather than failing.
      img.onerror = function () {
        URL.revokeObjectURL(url);
        resolve({ file: file });
      };

      img.onload = function () {
        URL.revokeObjectURL(url);
        var scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));

        // Animated, or already small enough -- keep it, but record its size so
        // the page can reserve the right space while it loads.
        if (file.type === 'image/gif' || (scale === 1 && file.size <= ALWAYS_FINE)) {
          return resolve({ file: file, width: img.width, height: img.height });
        }

        var canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);

        canvas.toBlob(function (blob) {
          // Keep the original if re-encoding did not actually help.
          if (!blob || blob.size >= file.size) {
            return resolve({ file: file, width: img.width, height: img.height });
          }
          var name = (file.name || 'image').replace(/\.[^.]+$/, '') + '.webp';
          resolve({
            file: new File([blob], name, { type: 'image/webp' }),
            width: canvas.width,
            height: canvas.height,
            shrunkFrom: file.size,
          });
        }, 'image/webp', 0.85);
      };

      img.src = url;
    });
  }

  function upload(original) {
    if (!original || original.size === 0) return;
    say('Preparing ' + (original.name || 'image') + '...');

    shrink(original).then(function (result) {
      var file = result.file;
      if (file.size > 15 * 1024 * 1024) {
        say('That file is ' + readable(file.size) + ', over the 15MB limit.', true);
        return;
      }
      say('Uploading ' + readable(file.size)
        + (result.shrunkFrom ? ' (reduced from ' + readable(result.shrunkFrom) + ')' : '')
        + '...');

      return fetch('/kb/upload', {
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
          insertImage(data.url, original.name, result.width, result.height);
          say('');
        });
    }).catch(function (err) { say(err.message, true); });
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
