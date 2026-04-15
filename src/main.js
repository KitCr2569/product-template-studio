// ============================================
// Product Template Studio — Main Application
// ============================================

let imglyRemoveBackground = null;
// Dynamic import to avoid blocking app init
async function loadBgRemovalLib() {
  try {
    const module = await import("@imgly/background-removal");
    // The library exports { removeBackground } — no default export
    imglyRemoveBackground = module.removeBackground;
    console.log('[Studio] Background removal library loaded successfully');
    console.log('[Studio] removeBackground type:', typeof imglyRemoveBackground);
  } catch (err) {
    console.warn('[Studio] Background removal library failed to load:', err);
    imglyRemoveBackground = null;
  }
}

// Convert image to PNG blob URL to avoid AVIF/WebP format issues
async function convertImageToPngBlob(imageSrc) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((blob) => {
        if (blob) {
          const url = URL.createObjectURL(blob);
          resolve(url);
        } else {
          reject(new Error('Failed to convert image'));
        }
      }, 'image/png');
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = imageSrc;
  });
}

// remove.bg API background removal via Vite proxy
async function removeBackgroundWithAPI(imageSrc, apiKey) {
  console.log('[Studio] Using remove.bg API...');

  // Convert data URL or blob URL to File/Blob
  let imageBlob;
  if (imageSrc.startsWith('data:')) {
    const res = await fetch(imageSrc);
    imageBlob = await res.blob();
  } else if (imageSrc.startsWith('blob:')) {
    const res = await fetch(imageSrc);
    imageBlob = await res.blob();
  } else {
    throw new Error('Unsupported image source');
  }

  const formData = new FormData();
  formData.append('image_file', imageBlob, 'product.png');
  formData.append('size', 'auto');
  formData.append('format', 'png');

  const response = await fetch('/api/removebg', {
    method: 'POST',
    headers: {
      'X-Api-Key': apiKey,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const errorMsg = errorData.errors?.[0]?.title || `HTTP ${response.status}`;
    throw new Error(`remove.bg: ${errorMsg}`);
  }

  const blob = await response.blob();
  return blob;
}

// --- Default Settings ---
const DEFAULTS = {
  positionX: 50,
  positionY: 58,
  scale: 45,
  shadowBlur: 20,
  shadowOpacity: 30,
  shadowOffsetY: 8,
  shadowSpread: 35,
};

// --- Application State ---
const state = {
  templateImg: null,
  productImg: null,         // original
  productNoBgImg: null,     // after bg removal
  isProcessing: false,
  isDragging: false,
  dragStart: { x: 0, y: 0 },
  dragOrigSettings: { positionX: 0, positionY: 0 },
  settings: { ...DEFAULTS },
  bgMethod: 'removebg',  // 'removebg' or 'local'
  // Eraser
  tool: 'move',  // 'move' or 'eraser'
  isErasing: false,
  eraserSize: 25,
  // Product editing canvas (for eraser)
  productCanvas: null,
  productCtx: null,
  // Undo stack
  undoStack: [],
  maxUndo: 20,
};

// --- DOM References ---
const $ = (sel) => document.querySelector(sel);
const dom = {};

function cacheDom() {
  // Uploads
  dom.templateCard = $('#template-upload-card');
  dom.templateInput = $('#template-input');
  dom.templatePlaceholder = $('#template-placeholder');
  dom.templatePreviewWrap = $('#template-preview-wrap');
  dom.templatePreview = $('#template-preview');
  dom.removeTemplate = $('#remove-template');
  dom.saveTemplateBtn = $('#save-template');

  dom.productCard = $('#product-upload-card');
  dom.productInput = $('#product-input');
  dom.productPlaceholder = $('#product-placeholder');
  dom.productPreviewWrap = $('#product-preview-wrap');
  dom.productPreview = $('#product-preview');
  dom.removeProduct = $('#remove-product');

  dom.skipBgRemoval = $('#skip-bg-removal');

  // BG removal method
  dom.methodRemovebg = $('#method-removebg');
  dom.methodLocal = $('#method-local');
  dom.apiKeySection = $('#api-key-section');
  dom.apiKeyInput = $('#api-key-input');
  dom.apiKeyToggle = $('#api-key-toggle');

  // Canvas
  dom.canvasContainer = $('#canvas-container');
  dom.canvas = $('#result-canvas');
  dom.ctx = dom.canvas.getContext('2d');
  dom.canvasEmpty = $('#canvas-empty');
  dom.dragHint = $('#drag-hint');

  // Toolbar
  dom.btnMove = $('#btn-move');
  dom.btnEraser = $('#btn-eraser');
  dom.btnUndo = $('#btn-undo');
  dom.eraserSizeWrap = $('#eraser-size-wrap');
  dom.eraserSize = $('#eraser-size');
  dom.eraserSizeVal = $('#eraser-size-val');
  dom.apiKeySave = $('#api-key-save');
  dom.eraserCursor = $('#eraser-cursor');

  // Controls
  dom.ctrlPosX = $('#ctrl-pos-x');
  dom.ctrlPosY = $('#ctrl-pos-y');
  dom.ctrlScale = $('#ctrl-scale');
  dom.ctrlShadowBlur = $('#ctrl-shadow-blur');
  dom.ctrlShadowOpacity = $('#ctrl-shadow-opacity');
  dom.ctrlShadowOffset = $('#ctrl-shadow-offset');
  dom.ctrlShadowSpread = $('#ctrl-shadow-spread');

  dom.valPosX = $('#val-pos-x');
  dom.valPosY = $('#val-pos-y');
  dom.valScale = $('#val-scale');
  dom.valShadowBlur = $('#val-shadow-blur');
  dom.valShadowOpacity = $('#val-shadow-opacity');
  dom.valShadowOffset = $('#val-shadow-offset');
  dom.valShadowSpread = $('#val-shadow-spread');

  dom.resetBtn = $('#reset-btn');
  dom.downloadBtn = $('#download-btn');
  dom.applyBtn = $('#apply-btn');

  // Overlay
  dom.overlay = $('#processing-overlay');
  dom.processingTitle = $('#processing-title');
  dom.processingSubtitle = $('#processing-subtitle');
  dom.progressFill = $('#progress-fill');

  // Toast
  dom.toastContainer = $('#toast-container');
}

// --- Initialization ---
function init() {
  cacheDom();
  setupUploadHandlers();
  setupControls();
  setupCanvasDrag();
  setupDownload();
  setupApply();
  setupBgMethodSelector();
  setupTemplateSaving();
  updateControlValues();
  loadSavedTemplate();
  // Load background removal library in background
  loadBgRemovalLib();
}

// ============================================
// BG METHOD SELECTOR
// ============================================

function setupBgMethodSelector() {
  // Load saved API key
  const savedKey = localStorage.getItem('removebg_api_key') || 'PhcWgKSF3bzZyHujYpH62aPy';
  if (savedKey && dom.apiKeyInput) {
    dom.apiKeyInput.value = savedKey;
  }

  // Load saved method
  const savedMethod = localStorage.getItem('bg_method') || 'removebg';
  state.bgMethod = savedMethod;
  updateMethodUI();

  // Method buttons
  dom.methodRemovebg?.addEventListener('click', () => {
    state.bgMethod = 'removebg';
    localStorage.setItem('bg_method', 'removebg');
    updateMethodUI();
  });

  dom.methodLocal?.addEventListener('click', () => {
    state.bgMethod = 'local';
    localStorage.setItem('bg_method', 'local');
    updateMethodUI();
  });

  // API key save on change
  dom.apiKeyInput?.addEventListener('change', () => {
    const key = dom.apiKeyInput.value.trim();
    if (key) {
      localStorage.setItem('removebg_api_key', key);
      showToast('บันทึก API Key แล้ว', 'success');
    }
  });

  // Save button for API key
  dom.apiKeySave?.addEventListener('click', () => {
    const key = dom.apiKeyInput?.value?.trim();
    if (key) {
      localStorage.setItem('removebg_api_key', key);
      showToast('บันทึก API Key เรียบร้อย!', 'success');
    } else {
      showToast('กรุณาใส่ API Key', 'error');
    }
  });

  // Toggle API key visibility
  dom.apiKeyToggle?.addEventListener('click', () => {
    const input = dom.apiKeyInput;
    if (input.type === 'password') {
      input.type = 'text';
    } else {
      input.type = 'password';
    }
  });
}

function updateMethodUI() {
  const isRemoveBg = state.bgMethod === 'removebg';

  dom.methodRemovebg?.classList.toggle('active', isRemoveBg);
  dom.methodLocal?.classList.toggle('active', !isRemoveBg);

  if (dom.apiKeySection) {
    dom.apiKeySection.classList.toggle('hidden-section', !isRemoveBg);
  }
}

// ============================================
// UPLOAD HANDLING
// ============================================

function setupUploadHandlers() {
  // Template
  setupDropZone(dom.templateCard, dom.templateInput, handleTemplateFile);
  dom.removeTemplate.addEventListener('click', (e) => {
    e.stopPropagation();
    clearTemplate();
  });

  // Product
  setupDropZone(dom.productCard, dom.productInput, handleProductFile);
  dom.removeProduct.addEventListener('click', (e) => {
    e.stopPropagation();
    clearProduct();
  });
}

function setupDropZone(card, input, handler) {
  // Click to upload — single click only
  card.addEventListener('click', (e) => {
    if (e.target === input) return; // don't double-trigger
    if (!card.classList.contains('has-image')) {
      input.click();
    }
  });

  input.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handler(e.target.files[0]);
    }
  });

  // Drag & Drop
  card.addEventListener('dragover', (e) => {
    e.preventDefault();
    card.classList.add('drag-over');
  });

  card.addEventListener('dragleave', () => {
    card.classList.remove('drag-over');
  });

  card.addEventListener('drop', (e) => {
    e.preventDefault();
    card.classList.remove('drag-over');
    if (e.dataTransfer.files.length > 0) {
      handler(e.dataTransfer.files[0]);
    }
  });
}

function handleTemplateFile(file) {
  if (!file.type.startsWith('image/')) {
    showToast('กรุณาเลือกไฟล์ภาพ', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      state.templateImg = img;

      // Show preview
      dom.templatePreview.src = e.target.result;
      dom.templatePlaceholder.classList.add('hidden');
      dom.templatePreviewWrap.classList.remove('hidden');
      dom.templateCard.classList.add('has-image');

      showToast('อัปโหลดเทมเพลตสำเร็จ', 'success');
      render();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

async function handleProductFile(file) {
  if (!file.type.startsWith('image/')) {
    showToast('กรุณาเลือกไฟล์ภาพ', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onload = async (e) => {
    const imgSrc = e.target.result;

    // Keep original
    const origImg = new Image();
    origImg.src = imgSrc;
    await new Promise(r => origImg.onload = r);
    state.productImg = origImg;

    const skipBg = dom.skipBgRemoval.checked;

    if (skipBg) {
      // Use as-is (already transparent)
      state.productNoBgImg = origImg;
      showProductPreview(imgSrc);
      showToast('ใช้ภาพสินค้าตามที่อัปโหลด', 'success');
      initProductCanvas();
      render();
    } else {
      // Remove background
      await processBackgroundRemoval(imgSrc);
    }
  };
  reader.readAsDataURL(file);
}

async function processBackgroundRemoval(imageSrc) {
  if (state.isProcessing) return;
  state.isProcessing = true;

  const useRemoveBg = state.bgMethod === 'removebg';
  const apiKey = dom.apiKeyInput?.value?.trim();

  // Validate remove.bg method
  if (useRemoveBg && !apiKey) {
    state.isProcessing = false;
    showToast('กรุณาใส่ remove.bg API Key ก่อน', 'error');
    dom.apiKeyInput?.focus();
    return;
  }

  // For local AI, ensure library is loaded
  if (!useRemoveBg && !imglyRemoveBackground) {
    showOverlay('กำลังโหลดโมเดล AI...', 'กำลังเตรียมระบบตัดพื้นหลัง');
    await loadBgRemovalLib();
    if (!imglyRemoveBackground) {
      state.isProcessing = false;
      hideOverlay();
      showToast('ไม่สามารถโหลด Local AI ได้ ลองใช้ remove.bg แทน', 'error');
      return;
    }
  }

  const methodLabel = useRemoveBg ? 'remove.bg API' : 'Local AI';
  showOverlay('กำลังตัดพื้นหลัง...', `ใช้ ${methodLabel} ในการตัดพื้นหลัง`);
  animateProgress(0, 80, useRemoveBg ? 5000 : 15000);

  try {
    let resultBlob;

    if (useRemoveBg) {
      // --- remove.bg API ---
      console.log('[Studio] Using remove.bg API method');
      // Convert to PNG first
      let processableSrc = imageSrc;
      try {
        processableSrc = await convertImageToPngBlob(imageSrc);
      } catch (e) { /* use original */ }

      resultBlob = await removeBackgroundWithAPI(processableSrc, apiKey);
    } else {
      // --- Local AI ---
      console.log('[Studio] Using Local AI method');
      let processableSrc = imageSrc;
      try {
        processableSrc = await convertImageToPngBlob(imageSrc);
      } catch (e) { /* use original */ }

      resultBlob = await imglyRemoveBackground(processableSrc, {
        progress: (key, current, total) => {
          if (total > 0) {
            const pct = Math.min(90, (current / total) * 90);
            setProgress(pct);
          }
        }
      });
    }

    setProgress(100);

    const url = URL.createObjectURL(resultBlob);
    const img = new Image();
    img.onload = () => {
      state.productNoBgImg = img;
      showProductPreview(url);
      hideOverlay();
      state.isProcessing = false;
      showToast(`ตัดพื้นหลังสำเร็จ! (${methodLabel})`, 'success');
      initProductCanvas();
      render();
    };
    img.onerror = () => {
      hideOverlay();
      state.isProcessing = false;
      showToast('ไม่สามารถโหลดภาพผลลัพธ์ได้', 'error');
    };
    img.src = url;
  } catch (err) {
    console.error('Background removal failed:', err);
    hideOverlay();
    state.isProcessing = false;
    showToast('ตัดพื้นหลังไม่สำเร็จ: ' + (err.message || 'Unknown error'), 'error');

    // Fallback: use original image
    state.productNoBgImg = state.productImg;
    showProductPreview(state.productImg.src);
    render();
  }
}

function showProductPreview(src) {
  dom.productPreview.src = src;
  dom.productPlaceholder.classList.add('hidden');
  dom.productPreviewWrap.classList.remove('hidden');
  dom.productCard.classList.add('has-image');
}

function clearTemplate() {
  state.templateImg = null;
  dom.templatePreview.src = '';
  dom.templatePlaceholder.classList.remove('hidden');
  dom.templatePreviewWrap.classList.add('hidden');
  dom.templateCard.classList.remove('has-image');
  dom.templateInput.value = '';
  render();
}

function clearProduct() {
  state.productImg = null;
  state.productNoBgImg = null;
  state.productCanvas = null;
  state.productCtx = null;
  state.undoStack = [];
  updateUndoButton();
  dom.productPreview.src = '';
  dom.productPlaceholder.classList.remove('hidden');
  dom.productPreviewWrap.classList.add('hidden');
  dom.productCard.classList.remove('has-image');
  dom.productInput.value = '';
  setTool('move');
  render();
}

// ============================================
// CANVAS RENDERING
// ============================================

function render() {
  const { templateImg, productNoBgImg, settings } = state;
  const { canvas, ctx } = dom;

  // Show/hide canvas empty state
  if (!templateImg && !productNoBgImg) {
    canvas.classList.remove('active');
    dom.canvasEmpty.classList.remove('hidden');
    dom.dragHint.classList.add('hidden');
    dom.downloadBtn.disabled = true;
    if (dom.applyBtn) dom.applyBtn.disabled = true;
    return;
  }

  // Set canvas size to template or product size
  const baseImg = templateImg || productNoBgImg;
  canvas.width = baseImg.width;
  canvas.height = baseImg.height;
  canvas.classList.add('active');
  dom.canvasEmpty.classList.add('hidden');

  // Clear
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw template
  if (templateImg) {
    ctx.drawImage(templateImg, 0, 0, canvas.width, canvas.height);
  }

  // Draw product with shadow
  if (productNoBgImg) {
    // Use the editable product canvas if available (for eraser)
    const drawSource = state.productCanvas || productNoBgImg;
    drawProductWithShadow(ctx, canvas.width, canvas.height, drawSource, settings);
    if (state.tool === 'move') {
      dom.dragHint.classList.remove('hidden');
    }
    dom.downloadBtn.disabled = false;
    if (dom.applyBtn) dom.applyBtn.disabled = false;
  } else {
    dom.dragHint.classList.add('hidden');
    dom.downloadBtn.disabled = true;
    if (dom.applyBtn) dom.applyBtn.disabled = true;
  }
}

function drawProductWithShadow(ctx, canvasW, canvasH, productImg, s) {
  // Calculate product dimensions
  const productW = canvasW * (s.scale / 100);
  const aspectRatio = productImg.height / productImg.width;
  const productH = productW * aspectRatio;

  const centerX = canvasW * (s.positionX / 100);
  const baseY = canvasH * (s.positionY / 100);
  const productX = centerX - productW / 2;
  const productY = baseY - productH;

  // --- Draw Shadow ---
  if (s.shadowOpacity > 0 && s.shadowBlur > 0) {
    ctx.save();

    // Create a temporary canvas for the shadow
    const shadowCanvas = document.createElement('canvas');
    const shadowCtx = shadowCanvas.getContext('2d');
    const pad = s.shadowBlur * 3;
    shadowCanvas.width = productW + pad * 2;
    shadowCanvas.height = productH + pad * 2;

    // Draw the product silhouette
    shadowCtx.drawImage(productImg, pad, pad, productW, productH);

    // Turn it black (keep alpha channel)
    shadowCtx.globalCompositeOperation = 'source-in';
    shadowCtx.fillStyle = '#000000';
    shadowCtx.fillRect(0, 0, shadowCanvas.width, shadowCanvas.height);

    // Now draw the shadow (squashed) on main canvas with blur
    ctx.globalAlpha = s.shadowOpacity / 100;
    ctx.filter = `blur(${s.shadowBlur}px)`;

    // Squash the shadow vertically
    const shadowScaleY = 0.15;
    const shadowW = productW * (s.shadowSpread / 100) * 2;
    const shadowH = productH * shadowScaleY;
    const shadowX = centerX - shadowW / 2 - pad * (shadowW / (productW + pad * 2)) ;
    const shadowY = baseY + s.shadowOffsetY - shadowH / 2 - pad * shadowScaleY;

    ctx.drawImage(
      shadowCanvas,
      centerX - shadowW / 2 - pad * (shadowW / productW) / 2,
      shadowY,
      shadowW + pad * 2 * (shadowW / productW),
      shadowH + pad * 2 * shadowScaleY
    );

    ctx.restore();
  }

  // Also draw a simple elliptical shadow for a cleaner look
  if (s.shadowOpacity > 0) {
    ctx.save();
    ctx.globalAlpha = (s.shadowOpacity / 100) * 0.5;
    ctx.filter = `blur(${s.shadowBlur * 0.8}px)`;
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.ellipse(
      centerX,
      baseY + s.shadowOffsetY,
      productW * (s.shadowSpread / 100),
      s.shadowBlur * 0.4,
      0, 0, Math.PI * 2
    );
    ctx.fill();
    ctx.restore();
  }

  // --- Draw Product ---
  ctx.drawImage(productImg, productX, productY, productW, productH);
}

// ============================================
// CONTROLS
// ============================================

function setupControls() {
  const controls = [
    { el: dom.ctrlPosX, key: 'positionX', valEl: dom.valPosX, suffix: '%' },
    { el: dom.ctrlPosY, key: 'positionY', valEl: dom.valPosY, suffix: '%' },
    { el: dom.ctrlScale, key: 'scale', valEl: dom.valScale, suffix: '%' },
    { el: dom.ctrlShadowBlur, key: 'shadowBlur', valEl: dom.valShadowBlur, suffix: 'px' },
    { el: dom.ctrlShadowOpacity, key: 'shadowOpacity', valEl: dom.valShadowOpacity, suffix: '%' },
    { el: dom.ctrlShadowOffset, key: 'shadowOffsetY', valEl: dom.valShadowOffset, suffix: 'px' },
    { el: dom.ctrlShadowSpread, key: 'shadowSpread', valEl: dom.valShadowSpread, suffix: '%' },
  ];

  controls.forEach(({ el, key, valEl, suffix }) => {
    el.addEventListener('input', () => {
      state.settings[key] = parseFloat(el.value);
      valEl.textContent = el.value + suffix;
      render();
    });
  });

  // Reset
  dom.resetBtn.addEventListener('click', () => {
    state.settings = { ...DEFAULTS };
    updateControlValues();
    render();
    showToast('รีเซ็ตค่าเริ่มต้นแล้ว', 'success');
  });
}

function updateControlValues() {
  const s = state.settings;
  dom.ctrlPosX.value = s.positionX;
  dom.ctrlPosY.value = s.positionY;
  dom.ctrlScale.value = s.scale;
  dom.ctrlShadowBlur.value = s.shadowBlur;
  dom.ctrlShadowOpacity.value = s.shadowOpacity;
  dom.ctrlShadowOffset.value = s.shadowOffsetY;
  dom.ctrlShadowSpread.value = s.shadowSpread;

  dom.valPosX.textContent = s.positionX + '%';
  dom.valPosY.textContent = s.positionY + '%';
  dom.valScale.textContent = s.scale + '%';
  dom.valShadowBlur.textContent = s.shadowBlur + 'px';
  dom.valShadowOpacity.textContent = s.shadowOpacity + '%';
  dom.valShadowOffset.textContent = s.shadowOffsetY + 'px';
  dom.valShadowSpread.textContent = s.shadowSpread + '%';
}

// ============================================
// CANVAS DRAG (Move product by dragging)
// ============================================

function setupCanvasDrag() {
  const canvas = dom.canvas;

  canvas.addEventListener('mousedown', onDragStart);
  canvas.addEventListener('mousemove', onDragMove);
  canvas.addEventListener('mouseup', onDragEnd);
  canvas.addEventListener('mouseleave', onDragEnd);

  // Touch support
  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    onDragStart({ clientX: touch.clientX, clientY: touch.clientY });
  }, { passive: false });

  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    onDragMove({ clientX: touch.clientX, clientY: touch.clientY });
  }, { passive: false });

  canvas.addEventListener('touchend', onDragEnd);
}

function getCanvasCoords(e) {
  const rect = dom.canvas.getBoundingClientRect();
  const scaleX = dom.canvas.width / rect.width;
  const scaleY = dom.canvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY,
  };
}

function onDragStart(e) {
  if (state.tool !== 'move') return;
  if (!state.productNoBgImg) return;

  const coords = getCanvasCoords(e);
  state.isDragging = true;
  state.dragStart = { x: coords.x, y: coords.y };
  state.dragOrigSettings = {
    positionX: state.settings.positionX,
    positionY: state.settings.positionY,
  };
  dom.canvas.style.cursor = 'grabbing';
}

function onDragMove(e) {
  if (!state.isDragging) return;

  const coords = getCanvasCoords(e);
  const dx = coords.x - state.dragStart.x;
  const dy = coords.y - state.dragStart.y;

  const canvasW = dom.canvas.width;
  const canvasH = dom.canvas.height;

  state.settings.positionX = Math.max(10, Math.min(90,
    state.dragOrigSettings.positionX + (dx / canvasW) * 100
  ));
  state.settings.positionY = Math.max(20, Math.min(95,
    state.dragOrigSettings.positionY + (dy / canvasH) * 100
  ));

  updateControlValues();
  render();
}

function onDragEnd() {
  if (state.isDragging) {
    state.isDragging = false;
    dom.canvas.style.cursor = 'grab';
  }
}

// Scroll to zoom on canvas
function setupCanvasScroll() {
  dom.canvas.addEventListener('wheel', (e) => {
    if (!state.productNoBgImg) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -1 : 1;
    state.settings.scale = Math.max(10, Math.min(90,
      state.settings.scale + delta * 1.5
    ));
    updateControlValues();
    render();
  }, { passive: false });
}

// ============================================
// DOWNLOAD
// ============================================

function setupDownload() {
  dom.downloadBtn.addEventListener('click', () => {
    if (!dom.canvas.width || !dom.canvas.height) return;

    dom.canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `product-template-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('ดาวน์โหลดเรียบร้อย!', 'success');
    }, 'image/png');
  });
}

function setupApply() {
  if (!dom.applyBtn) return;
  
  const urlParams = new URLSearchParams(window.location.search);
  const hasTarget = urlParams.has('target');
  
  // Show apply button if opened from admin (popup, iframe, or has target param)
  if (window.opener || window.parent !== window || hasTarget) {
    dom.applyBtn.style.display = 'flex';
  } else {
    dom.applyBtn.style.display = 'none';
  }

  dom.applyBtn.addEventListener('click', () => {
    if (!dom.canvas.width || !dom.canvas.height) return;

    const originalContent = dom.applyBtn.innerHTML;
    dom.applyBtn.disabled = true;
    dom.applyBtn.innerHTML = 'กำลังประมวลผล...';

    dom.canvas.toBlob((blob) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result;
        const params = new URLSearchParams(window.location.search);
        const messageData = {
          type: 'TEMPLATE_STUDIO_RESULT',
          index: params.get('index'),
          imageDataUrl: dataUrl
        };
        
        // Determine target: parent (iframe) or opener (popup)
        let target = null;
        try {
          if (window.parent && window.parent !== window) {
            target = window.parent;
          }
        } catch (e) {
          // cross-origin parent access might throw
        }
        if (!target && window.opener) {
          target = window.opener;
        }
        
        if (target) {
          try {
            target.postMessage(messageData, '*');
            showToast('ส่งภาพไปยังร้านค้าเรียบร้อย!', 'success');
            
            if (window.opener && target === window.opener) {
              dom.applyBtn.innerHTML = 'ส่งสำเร็จ! กำลังปิด...';
              setTimeout(() => window.close(), 1000);
            } else {
              dom.applyBtn.innerHTML = '✅ ส่งสำเร็จ!';
              setTimeout(() => {
                dom.applyBtn.innerHTML = originalContent;
                dom.applyBtn.disabled = false;
              }, 2000);
            }
          } catch (err) {
            showToast('ส่งรูปล้มเหลว: ' + err.message, 'error');
            dom.applyBtn.innerHTML = originalContent;
            dom.applyBtn.disabled = false;
          }
        } else {
          showToast('ไม่สามารถส่งรูปไฟล์ — กรุณาดาวน์โหลด PNG แทน', 'error');
          dom.applyBtn.innerHTML = originalContent;
          dom.applyBtn.disabled = false;
        }
      };
      reader.readAsDataURL(blob);
    }, 'image/png');
  });
}

// ============================================
// OVERLAY / LOADING
// ============================================

function showOverlay(title, subtitle) {
  dom.processingTitle.textContent = title;
  dom.processingSubtitle.textContent = subtitle;
  dom.progressFill.style.width = '0%';
  dom.overlay.classList.remove('hidden');
}

function hideOverlay() {
  dom.overlay.classList.add('hidden');
}

let progressTimer = null;

function animateProgress(from, to, duration) {
  clearInterval(progressTimer);
  let current = from;
  const step = (to - from) / (duration / 100);

  progressTimer = setInterval(() => {
    current = Math.min(to, current + step);
    dom.progressFill.style.width = current + '%';
    if (current >= to) clearInterval(progressTimer);
  }, 100);
}

function setProgress(pct) {
  clearInterval(progressTimer);
  dom.progressFill.style.width = pct + '%';
}

// ============================================
// TOAST NOTIFICATIONS
// ============================================

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icons = {
    success: '✅',
    error: '❌',
    info: 'ℹ️',
  };

  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <span>${message}</span>
  `;

  dom.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(40px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ============================================
// ERASER & UNDO
// ============================================

function setupEraserTool() {
  // Tool buttons
  dom.btnMove?.addEventListener('click', () => setTool('move'));
  dom.btnEraser?.addEventListener('click', () => setTool('eraser'));
  dom.btnUndo?.addEventListener('click', performUndo);

  // Eraser size
  dom.eraserSize?.addEventListener('input', () => {
    state.eraserSize = parseInt(dom.eraserSize.value);
    if (dom.eraserSizeVal) dom.eraserSizeVal.textContent = state.eraserSize;
    // Update cursor size on screen immediately
    if (dom.canvas && dom.eraserCursor) {
      const rect = dom.canvas.getBoundingClientRect();
      if (rect.width > 0) {
        const scaleX = rect.width / dom.canvas.width;
        const screenDiameter = state.eraserSize * scaleX * 2;
        dom.eraserCursor.style.width = screenDiameter + 'px';
        dom.eraserCursor.style.height = screenDiameter + 'px';
      }
    }
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'm' || e.key === 'M') setTool('move');
    if (e.key === 'e' || e.key === 'E') setTool('eraser');
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault();
      performUndo();
    }
  });

  // Canvas eraser events
  dom.canvas.addEventListener('mousedown', onEraserStart);
  dom.canvas.addEventListener('mousemove', onEraserHoverMove); // generalized move tracker
  dom.canvas.addEventListener('mouseup', onEraserEnd);
  dom.canvas.addEventListener('mouseleave', () => {
    onEraserEnd();
    dom.eraserCursor?.classList.add('hidden');
  });
  dom.canvas.addEventListener('mouseenter', () => {
    if (state.tool === 'eraser') dom.eraserCursor?.classList.remove('hidden');
  });

  // Touch
  dom.canvas.addEventListener('touchstart', (e) => {
    if (state.tool !== 'eraser') return;
    e.preventDefault();
    const t = e.touches[0];
    onEraserStart({ clientX: t.clientX, clientY: t.clientY });
  }, { passive: false });
  dom.canvas.addEventListener('touchmove', (e) => {
    if (state.tool !== 'eraser') return;
    e.preventDefault();
    const t = e.touches[0];
    onEraserHoverMove({ clientX: t.clientX, clientY: t.clientY });
  }, { passive: false });
  dom.canvas.addEventListener('touchend', () => {
    onEraserEnd();
    dom.eraserCursor?.classList.add('hidden');
  });
}

function updateEraserCursorUI(e) {
  if (state.tool !== 'eraser' || !dom.eraserCursor) return;
  dom.eraserCursor.classList.remove('hidden');
  dom.eraserCursor.style.left = e.clientX + 'px';
  dom.eraserCursor.style.top = e.clientY + 'px';
  
  // Calculate size on screen
  if (dom.canvas) {
    const rect = dom.canvas.getBoundingClientRect();
    if (rect.width > 0) {
      const scaleX = rect.width / dom.canvas.width;
      const screenDiameter = state.eraserSize * scaleX * 2;
      dom.eraserCursor.style.width = screenDiameter + 'px';
      dom.eraserCursor.style.height = screenDiameter + 'px';
    }
  }
}

function setTool(tool) {
  state.tool = tool;
  dom.btnMove?.setAttribute('data-active', tool === 'move' ? 'true' : 'false');
  dom.btnEraser?.setAttribute('data-active', tool === 'eraser' ? 'true' : 'false');
  dom.eraserSizeWrap?.classList.toggle('hidden', tool !== 'eraser');
  dom.canvas.classList.toggle('canvas-eraser-active', tool === 'eraser');

  if (tool === 'eraser') {
    dom.dragHint?.classList.add('hidden');
    // Hide initially until mouse enters canvas
    dom.eraserCursor?.classList.add('hidden');
  } else {
    dom.eraserCursor?.classList.add('hidden');
  }
}

// Create fresh product canvas for erasing (called once on product load)
function initProductCanvas() {
  if (!state.productNoBgImg) return;
  state.productCanvas = document.createElement('canvas');
  state.productCtx = state.productCanvas.getContext('2d');
  state.productCanvas.width = state.productNoBgImg.naturalWidth || state.productNoBgImg.width;
  state.productCanvas.height = state.productNoBgImg.naturalHeight || state.productNoBgImg.height;
  state.productCtx.drawImage(state.productNoBgImg, 0, 0);
  state.undoStack = [];
  updateUndoButton();
  console.log('[Studio] Product canvas initialized:', state.productCanvas.width, 'x', state.productCanvas.height);
}

function pushUndoState() {
  if (!state.productCanvas) return;
  const data = state.productCtx.getImageData(
    0, 0, state.productCanvas.width, state.productCanvas.height
  );
  state.undoStack.push(data);
  if (state.undoStack.length > state.maxUndo) {
    state.undoStack.shift();
  }
  updateUndoButton();
}

function performUndo() {
  if (state.undoStack.length === 0) return;
  const data = state.undoStack.pop();
  state.productCtx.putImageData(data, 0, 0);
  updateUndoButton();
  render();
}

function updateUndoButton() {
  if (dom.btnUndo) {
    dom.btnUndo.disabled = state.undoStack.length === 0;
  }
}

function getCanvasCoordsForEraser(e) {
  const rect = dom.canvas.getBoundingClientRect();
  const scaleX = dom.canvas.width / rect.width;
  const scaleY = dom.canvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY,
  };
}

function canvasToProductCoords(cx, cy) {
  const s = state.settings;
  const { canvas } = dom;
  const productW = canvas.width * (s.scale / 100);
  const productImg = state.productNoBgImg;
  const aspectRatio = productImg.height / productImg.width;
  const productH = productW * aspectRatio;
  const centerX = canvas.width * (s.positionX / 100);
  const baseY = canvas.height * (s.positionY / 100);
  const productX = centerX - productW / 2;
  const productY = baseY - productH;

  // Convert canvas coords to product image coords
  const px = ((cx - productX) / productW) * state.productCanvas.width;
  const py = ((cy - productY) / productH) * state.productCanvas.height;
  return { px, py, productW, productH };
}

function onEraserStart(e) {
  if (state.tool !== 'eraser' || !state.productCanvas) return;
  state.isErasing = true;
  pushUndoState();
  updateEraserCursorUI(e);
  eraseAt(e);
}

function onEraserHoverMove(e) {
  if (state.tool === 'eraser') updateEraserCursorUI(e);
  if (!state.isErasing || state.tool !== 'eraser') return;
  eraseAt(e);
}

function onEraserEnd() {
  if (state.isErasing) {
    state.isErasing = false;
    render();
  }
}

function eraseAt(e) {
  if (!state.productCanvas) return;
  const coords = getCanvasCoordsForEraser(e);
  const { px, py } = canvasToProductCoords(coords.x, coords.y);

  // Scale eraser size to product image space
  const s = state.settings;
  const productW = dom.canvas.width * (s.scale / 100);
  const scaleFactor = state.productCanvas.width / productW;
  const eraserR = state.eraserSize * scaleFactor;

  // Erase (set to transparent)
  state.productCtx.save();
  state.productCtx.globalCompositeOperation = 'destination-out';
  state.productCtx.beginPath();
  state.productCtx.arc(px, py, eraserR, 0, Math.PI * 2);
  state.productCtx.fill();
  state.productCtx.restore();

  render();
}

// ============================================
// TEMPLATE SAVING & LOADING
// ============================================

const DB_NAME = 'ProductTemplateStudio';
const DB_VERSION = 1;
const STORE_NAME = 'savedTemplate';

function setupTemplateSaving() {
  dom.saveTemplateBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!state.templateImg) {
      showToast('ไม่มีเทมเพลตให้บันทึก', 'error');
      return;
    }
    
    const data = {
      id: 'default',
      settings: state.settings,
      templateSrc: state.templateImg.src 
    };

    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (e) => {
        e.target.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      };
      request.onsuccess = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) return;
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(data);
        tx.oncomplete = () => {
          showToast('บันทึกเทมเพลตและค่าตั้งต้นสำเร็จ!', 'success');
        };
        tx.onerror = () => {
          showToast('ไม่สามารถบันทึกเทมเพลตได้', 'error');
        };
      };
      request.onerror = () => {
        showToast('ข้อมูลเทมเพลตมีขนาดใหญ่เกินไป หรือเบราว์เซอร์ไม่รองรับ', 'error');
      };
    } catch (err) {
      console.error('IndexedDB Error:', err);
      showToast('เกิดข้อผิดพลาดในการบันทึก', 'error');
    }
  });
}

function loadSavedTemplate() {
  try {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      e.target.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    request.onsuccess = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) return;
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get('default');
      
      getReq.onsuccess = () => {
        if (getReq.result) {
          const { settings, templateSrc } = getReq.result;
          
          // Restore settings
          if (settings) {
            state.settings = { ...state.settings, ...settings };
            updateControlValues();
            
            // Sync UI dom elements with restored settings
            if (dom.ctrlPosX) dom.ctrlPosX.value = state.settings.positionX;
            if (dom.ctrlPosY) dom.ctrlPosY.value = state.settings.positionY;
            if (dom.ctrlScale) dom.ctrlScale.value = state.settings.scale;
            if (dom.ctrlShadowBlur) dom.ctrlShadowBlur.value = state.settings.shadowBlur;
            if (dom.ctrlShadowOpacity) dom.ctrlShadowOpacity.value = state.settings.shadowOpacity;
            if (dom.ctrlShadowOffset) dom.ctrlShadowOffset.value = state.settings.shadowOffsetY;
            if (dom.ctrlShadowSpread) dom.ctrlShadowSpread.value = state.settings.shadowSpread;
          }

          // Restore template
          if (templateSrc) {
            const img = new Image();
            img.onload = () => {
              state.templateImg = img;
              dom.templatePreview.src = templateSrc;
              dom.templatePlaceholder.classList.add('hidden');
              dom.templatePreviewWrap.classList.remove('hidden');
              dom.templateCard.classList.add('has-image');
              render();
            };
            img.src = templateSrc;
          }
        }
      };
    };
  } catch (err) {
    console.error('Failed to load saved template:', err);
  }
}

// ============================================
// Start
// ============================================

document.addEventListener('DOMContentLoaded', () => {
  init();
  setupCanvasScroll();
  setupEraserTool();
});
