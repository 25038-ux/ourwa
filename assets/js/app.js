/**
 * EduPlatforme — JavaScript principal
 * Gestion sidebar, modales, notifications, AJAX helpers, input validation
 */

document.addEventListener('DOMContentLoaded', function() {
    // === Sidebar Toggle (mobile) ===
    const sidebar = document.getElementById('sidebar');
    const toggle = document.getElementById('sidebar-toggle');
    
    if (toggle && sidebar) {
        toggle.addEventListener('click', function() {
            sidebar.classList.toggle('open');
        });
        
        // Fermer la sidebar en cliquant en dehors (mobile)
        document.addEventListener('click', function(e) {
            if (window.innerWidth <= 768 && sidebar.classList.contains('open') &&
                !sidebar.contains(e.target) && !toggle.contains(e.target)) {
                sidebar.classList.remove('open');
            }
        });
    }

    // === Animations au scroll ===
    const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('animate-slide-up');
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1 });

    document.querySelectorAll('.kpi-card, .chart-card, .form-card, .table-container').forEach(el => {
        observer.observe(el);
    });

    // === CLIENT-SIDE INPUT VALIDATION ===
    initFormValidation();
});

// =============================================================================
//  INPUT VALIDATION SYSTEM
//  Validates all input fields and shows inline error messages instead of crashing
// =============================================================================
function initFormValidation() {
    // Attach validation to all forms (except GET forms used for navigation)
    document.querySelectorAll('form[method="POST"], form[method="post"]').forEach(form => {
        // Intercept submit
        form.addEventListener('submit', function(e) {
            if (!validateForm(form)) {
                e.preventDefault();
                e.stopPropagation();
            }
        });

        // Real-time validation on blur
        form.querySelectorAll('input, select, textarea').forEach(input => {
            if (input.type === 'hidden') return;
            
            input.addEventListener('blur', function() {
                validateField(input);
            });

            input.addEventListener('input', function() {
                // Clear error on typing
                clearFieldError(input);
            });
        });
    });
}

/**
 * Validate all fields in a form.
 * Returns true if all valid, false otherwise.
 */
function validateForm(form) {
    let isValid = true;
    form.querySelectorAll('input, select, textarea').forEach(input => {
        if (input.type === 'hidden') return;
        if (!validateField(input)) {
            isValid = false;
        }
    });
    
    // Focus the first invalid field
    if (!isValid) {
        const firstError = form.querySelector('.input-error');
        if (firstError) {
            firstError.focus();
            firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }
    
    return isValid;
}

/**
 * Validate a single field.
 * Returns true if valid, false otherwise.
 */
function validateField(input) {
    const value = input.value.trim();
    const name = input.name || '';
    const type = input.type || '';
    let errorMsg = '';

    // Skip disabled or hidden fields
    if (input.disabled || input.offsetParent === null) return true;

    // Required check
    if (input.required && value === '') {
        errorMsg = 'Ce champ est obligatoire.';
    }

    // Only validate further if there's a value
    if (!errorMsg && value !== '') {
        // Number validation
        if (type === 'number') {
            const num = parseFloat(value);
            if (isNaN(num)) {
                errorMsg = 'Veuillez entrer un nombre valide.';
            } else {
                const min = input.min !== '' ? parseFloat(input.min) : null;
                const max = input.max !== '' ? parseFloat(input.max) : null;
                if (min !== null && num < min) {
                    errorMsg = 'La valeur minimale est ' + min + '.';
                } else if (max !== null && num > max) {
                    errorMsg = 'La valeur maximale est ' + max + '.';
                }
            }
        }

        // Text fields — check for SQL injection-like patterns & prevent unexpected types
        if (type === 'text' || type === '') {
            // Champs « nom libre » : tout est autorisé (contexte bilingue, chiffres, ponctuation).
            var champLibre = (name === 'nom_groupe_cs' || name === 'description' ||
                              name === 'motif' || name === 'matiere' || name === 'creneau' ||
                              name === 'externe_nom' || name === 'debiteur_nom');
            if (!champLibre && value !== '') {
                // Anti-XSS minimal : on bloque seulement les chevrons.
                if (/[<>]/.test(value)) {
                    errorMsg = 'Les caractères < et > ne sont pas autorisés.';
                }
            }

            // Identifier fields
            if (name === 'identifiant' || name.startsWith('ident_')) {
                if (!/^[a-zA-Z0-9._@\-]+$/.test(value)) {
                    errorMsg = 'Caractères autorisés : lettres, chiffres, @, ., -, _';
                } else if (value.length < 3) {
                    errorMsg = 'Minimum 3 caractères.';
                }
            }

            // Phone fields
            if (name === 'telephone' || name === 'telephone_parent' || name.startsWith('tel_')) {
                if (value !== '' && !/^[\d\s\+\-\(\)]+$/.test(value)) {
                    errorMsg = 'Format invalide. Utilisez uniquement des chiffres, +, -, espaces.';
                }
            }

            // Function fields
            if (name === 'fonction') {
                if (!/^[\p{L}\s\-'\.\/,]+$/u.test(value)) {
                    errorMsg = 'Ce champ ne doit contenir que des lettres et caractères simples.';
                }
            }
        }

        // Password validation
        if (type === 'password' && name === 'mot_de_passe') {
            if (value.length < 6) {
                errorMsg = 'Le mot de passe doit contenir au moins 6 caractères.';
            }
        }

        // Email-type validation (not used here but just in case)
        if (type === 'email') {
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
                errorMsg = 'Adresse email invalide.';
            }
        }

        // Date validation
        if (type === 'date') {
            if (isNaN(Date.parse(value))) {
                errorMsg = 'Date invalide.';
            }
        }

        // Select validation
        if (input.tagName === 'SELECT' && input.required && value === '') {
            errorMsg = 'Veuillez sélectionner une option.';
        }
    }

    // Show or clear error
    if (errorMsg) {
        showFieldError(input, errorMsg);
        return false;
    } else {
        clearFieldError(input);
        return true;
    }
}

/**
 * Show an error message under a field.
 */
function showFieldError(input, message) {
    input.classList.add('input-error');
    
    // Find or create the error span
    let errorSpan = null;
    const fieldId = input.id || input.name;
    
    // Try to find existing error span by id
    if (fieldId) {
        errorSpan = document.getElementById('err-' + fieldId);
    }
    
    // If no dedicated span, create one after the input
    if (!errorSpan) {
        // Check if there's already a sibling error span
        const parent = input.closest('.form-group') || input.parentElement;
        errorSpan = parent.querySelector('.field-error');
        if (!errorSpan) {
            errorSpan = document.createElement('span');
            errorSpan.className = 'field-error';
            // Insert after input (or after input wrapper if wrapped)
            const insertAfter = input.parentElement.classList.contains('input-wrapper') 
                ? input.parentElement 
                : (input.nextElementSibling && input.nextElementSibling.tagName === 'BUTTON') 
                    ? input.parentElement
                    : input;
            insertAfter.parentElement.insertBefore(errorSpan, insertAfter.nextSibling);
        }
    }
    
    errorSpan.textContent = message;
}

/**
 * Clear the error on a field.
 */
function clearFieldError(input) {
    input.classList.remove('input-error');
    
    const fieldId = input.id || input.name;
    let errorSpan = null;
    
    if (fieldId) {
        errorSpan = document.getElementById('err-' + fieldId);
    }
    
    if (!errorSpan) {
        const parent = input.closest('.form-group') || input.parentElement;
        errorSpan = parent.querySelector('.field-error');
    }
    
    if (errorSpan) {
        errorSpan.textContent = '';
    }
}

// === Gestion des modales ===
function ouvrirModale(id) {
    const modal = document.getElementById(id);
    if (modal) {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
}

function fermerModale(id) {
    const modal = document.getElementById(id);
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }
}

// Fermer modale avec Escape
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay.active').forEach(m => {
            m.classList.remove('active');
            document.body.style.overflow = '';
        });
    }
});

// === Notifications toast ===
function afficherNotification(message, type = 'success') {
    const container = document.getElementById('notifications') || creerConteneurNotifs();
    const notif = document.createElement('div');
    notif.className = `alert alert-${type} animate-fade`;
    notif.textContent = message;
    notif.style.cssText = 'margin-bottom:.5rem;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.1);';
    notif.addEventListener('click', () => notif.remove());
    container.appendChild(notif);
    setTimeout(() => { notif.style.opacity = '0'; setTimeout(() => notif.remove(), 300); }, 4000);
}

function creerConteneurNotifs() {
    const c = document.createElement('div');
    c.id = 'notifications';
    c.style.cssText = 'position:fixed;top:1rem;right:1rem;z-index:300;max-width:400px;width:90%;';
    document.body.appendChild(c);
    return c;
}

// === AJAX Helper ===
async function requeteAjax(url, data = {}, method = 'POST') {
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content ||
                      document.querySelector('input[name="csrf_token"]')?.value || '';
    
    const options = {
        method: method,
        headers: { 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-TOKEN': csrfToken }
    };
    
    if (method === 'POST') {
        if (data instanceof FormData) {
            data.append('csrf_token', csrfToken);
            options.body = data;
        } else {
            const formData = new FormData();
            formData.append('csrf_token', csrfToken);
            Object.entries(data).forEach(([k, v]) => formData.append(k, v));
            options.body = formData;
        }
    }
    
    try {
        const response = await fetch(url, options);
        const result = await response.json();
        return result;
    } catch (error) {
        console.error('Erreur AJAX:', error);
        return { succes: false, message: 'Erreur de communication avec le serveur.' };
    }
}

// === Formater les nombres ===
function formaterNombre(n) {
    return new Intl.NumberFormat('fr-FR').format(n);
}

function formaterMonnaie(n) {
    return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n) + ' MRU';
}
