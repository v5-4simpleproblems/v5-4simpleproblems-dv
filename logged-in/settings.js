        import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
        import { 
            getAuth, 
            onAuthStateChanged, 
            signOut,
            EmailAuthProvider, 
            reauthenticateWithCredential, 
            updatePassword,
            // NEW AUTH IMPORTS
            GoogleAuthProvider,
            GithubAuthProvider,
            OAuthProvider,
            linkWithPopup,
            unlink,
            reauthenticateWithPopup,
            deleteUser
        } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
        import { 
            getFirestore, 
            doc, 
            getDoc, 
            updateDoc, 
            collection,
            query,
            where,
            getDocs,
            serverTimestamp,
            deleteDoc, // NEW FIREBASE IMPORT
            setDoc,
            writeBatch
        } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
        import { 
            getStorage, 
            ref, 
            listAll, 
            getDownloadURL, 
            uploadString, 
            deleteObject, 
            uploadBytes 
        } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
        
        // --- Import Firebase Config (Assumed to exist in a relative file) ---
        import { firebaseConfig } from "../firebase-config.js"; 
        
        // --- NEW: Import Site Mapping (from index.html logic) ---
        // This file MUST exist at ../site-mapping.js for import/export to work
        import { siteMapping } from "../site-mapping.js";


        if (!firebaseConfig || !firebaseConfig.apiKey) {
            console.error("FATAL ERROR: Firebase configuration is missing or invalid.");
        }

        // --- Firebase Initialization ---
        const app = initializeApp(firebaseConfig);
        const auth = getAuth(app);
        const db = getFirestore(app);
        const storage = getStorage(app);

        // --- Global State and Element References ---
        const sidebarTabs = document.querySelectorAll('.settings-tab');
        const mainView = document.getElementById('settings-main-view');
        let currentUser = null; // To store the authenticated user object
        let isUserAdmin = false; // Stores admin status result to prevent race conditions
        
        // --- NEW: Global var for loading overlay (from index.html) ---
        let loadingTimeout = null;
        
        // Constants for validation and limits
        const MIN_LENGTH = 6; 
        const MAX_LENGTH = 24;
        const MAX_CHANGES = 5; 


        // Tab Content Data Structure (can be expanded later)
        const tabContent = {
            'general': { title: 'General Settings', icon: 'fa-gear' },
            'personalization': { title: 'Personalization', icon: 'fa-palette' },
            'about': { title: 'About 4SP', icon: 'fa-circle-info' },
        };
        
        // Constants for providers (NEW)
        const PROVIDER_CONFIG = {
            'google.com': { 
                name: 'Google', 
                icon: '../images/google-icon.png', 
                instance: () => new GoogleAuthProvider() 
            },
            'github.com': { 
                name: 'GitHub', 
                icon: '../images/github-mark-white.png', 
                instance: () => new GithubAuthProvider() 
            },
            'microsoft.com': { 
                name: 'Microsoft', 
                icon: '../images/microsoft.png', 
                instance: () => new OAuthProvider('microsoft.com') 
            },
            'twitter.com': { // NEW: X (Twitter) Provider
                name: 'X (Twitter)',
                icon: '../images/x.png',
                instance: () => new OAuthProvider('twitter.com')
            },
            'password': { 
                name: 'Email & Password', 
                icon: '<i class="fa-solid fa-at fa-lg mr-3"></i>', 
                isCredential: true
            }
        };

        // --- NEW: Constants for Privacy Settings ---
        
        // IndexedDB Config for Panic Key
        const DB_NAME = 'userLocalSettingsDB';
        const STORE_NAME = 'panicKeyStore';
        
        // localStorage Key for URL Changer
        const URL_CHANGER_KEY = 'selectedUrlPreset';
        
        // --- NEW: Constant for Theme Storage ---
        // (Copied from navigation.js)
        const THEME_STORAGE_KEY = 'user-navbar-theme';


        // Presets copied from url-changer.js
        const urlChangerPresets = [
            { id: 'hac', name: 'HAC', title: 'Login', favicon: '../favicons/hac.png', category: 'websites' },
            { id: 'gmm', name: 'GMM', title: 'Get More Math!', favicon: '../favicons/gmm.png', category: 'websites' },
            { id: 'kahoot', name: 'Kahoot', title: 'Kahoot! | Learning games | Make learning awesome!', favicon: '../favicons/kahoot.png', category: 'websites' },
            { id: 'g_classroom', name: 'Google Classroom', title: 'Home', favicon: '../favicons/google-classroom.png', category: 'websites' },
            { id: 'g_docs', name: 'Google Docs', title: 'Google Docs', favicon: '../favicons/google-docs.png', category: 'websites' },
            { id: 'g_slides', name: 'Google Slides', title: 'Google Slides', favicon: '../favicons/google-slides.png', category: 'websites' },
            { id: 'g_drive', name: 'Google Drive', title: 'Home - Google Drive', favicon: '../favicons/google-drive.png', category: 'websites' },
            { id: 'wikipedia', name: 'Wikipedia', title: 'Wikipedia', favicon: '../favicons/wikipedia.png', category: 'websites' },
            { id: 'clever', name: 'Clever', title: 'Clever | Connect every student to a world of learning', favicon: '../favicons/clever.png', category: 'websites' },
            { id: '_LIVE_CURRENT_TIME', name: 'Current Time', title: 'Live Time', favicon: '', category: 'live', live: true }
        ];

        
        // --- Shared Helper Functions ---
        // --- Shared Helper Functions ---
        const getUserDocRef = (userId) => doc(db, 'users', userId);
        
        import { checkAdminStatus } from '../utils.js';
        
        const showMessage = (element, text, type = 'error') => {
            // Prevent clearing a success message if a warning is generated elsewhere
            if (element && element.innerHTML.includes('success') && type !== 'error') return;
            if (element) {
                element.innerHTML = text;
                element.className = `general-message-area text-sm ${type}-message`;
            }
        };
        
        const checkProfanity = async (text) => {
            try {
                const response = await fetch(`https://www.purgomalum.com/service/containsprofanity?text=${encodeURIComponent(text)}`);
                const result = await response.text();
                return result.toLowerCase() === 'true';
            } catch (error) { console.error('Profanity API error:', error); return false; }
        };

        const isUsernameTaken = async (username) => {
            const q = query(collection(db, 'users'), where('username', '==', username));
            const querySnapshot = await getDocs(q);
            return !querySnapshot.empty;
        };
        

        
        // --- NEW: Modal and Loading Functions (from index.html) ---
        
        function openModal(text, buttons = []) {
            const modal = document.getElementById('modalPrompt');
            const modalText = document.getElementById('modalText');
            const modalButtons = document.getElementById('modalButtons');
            
            modalText.textContent = text;
            modalButtons.innerHTML = "";
            buttons.forEach(btn => {
                const buttonEl = document.createElement("button");
                // MODIFICATION: Use settings page button styles
                buttonEl.className = "btn-toolbar-style";
                if (btn.text.toLowerCase() === 'yes') {
                    buttonEl.classList.add('btn-primary-override-danger'); // Make 'Yes' destructive
                } else {
                    buttonEl.classList.add('btn-primary-override');
                }
                buttonEl.textContent = btn.text;
                buttonEl.onclick = btn.onclick;
                modalButtons.appendChild(buttonEl);
            });
            modal.style.display = "flex";
        }
        
        function showLoading(text = "Loading...") {
            const loadingOverlay = document.getElementById('loadingOverlay');
            const loadingText = document.getElementById('loadingText');
            
            loadingText.textContent = text;
            loadingOverlay.style.display = "flex";
            loadingOverlay.classList.add("active");
            if (loadingTimeout) clearTimeout(loadingTimeout);
            loadingTimeout = setTimeout(() => {
                hideLoading();
            }, 5000); // 5 second timeout
        }

        function hideLoading() {
            const loadingOverlay = document.getElementById('loadingOverlay');
            if (loadingTimeout) {
                clearTimeout(loadingTimeout);
                loadingTimeout = null;
            }
            loadingOverlay.classList.remove("active");
            loadingOverlay.style.display = "none";
        }


        /**
         * Generates the HTML for the "Change Password" section.
         */
        function getChangePasswordSection() {
            return `
                <h3 class="text-xl font-bold text-white mb-2 mt-8">Change Password</h3>
                <div id="passwordChangeSection" class="settings-box w-full p-4">
                    <p class="text-sm font-light text-gray-400 mb-3">
                        Change your password. You must provide your current password for security.
                    </p>
                    
                    <div class="flex flex-col gap-3">
                        <input type="password" id="currentPasswordInput" placeholder="Current Password" class="input-text-style">
                        <input type="password" id="newPasswordInput" placeholder="New Password (min 6 characters)" class="input-text-style">
                        <input type="password" id="confirmPasswordInput" placeholder="Confirm New Password" class="input-text-style">
                    </div>
                    
                    <div class="flex justify-between items-center pt-4">
                        <p id="passwordMessage" class="general-message-area text-sm"></p>
                        <button id="applyPasswordBtn" class="btn-toolbar-style btn-primary-override w-32" disabled style="padding: 0.5rem 0.75rem;">
                            <i class="fa-solid fa-lock mr-1"></i> Apply
                        </button>
                    </div>
                </div>
            `;
        }
        
        /**
         * Renders the Linked Providers and Account Deletion section.
         */
        function getAccountManagementContent(providerData) {
            // Determine the Primary Provider (the first one in the list)
            const primaryProviderId = providerData && providerData.length > 0 ? providerData[0].providerId : null;
            
            let linkedProvidersHtml = providerData.map(info => {
                const id = info.providerId;
                const config = PROVIDER_CONFIG[id] || { name: id, icon: '<i class="fa-solid fa-puzzle-piece fa-lg mr-3"></i>' };
                
                const isPrimary = (id === primaryProviderId); // Check if this is the primary provider
                const canUnlink = providerData.length > 1 && !(id === 'password' && primaryProviderId === 'password');
                
                // NEW: Determine if "Set as Primary" button should be shown
                // Show if no primary is explicitly set, it's not the current primary, and it's not the password provider.
                const showSetPrimaryButton = !isPrimary && primaryProviderId === null && id !== 'password';

                // Determine if icon is an image or a FontAwesome icon
                let iconHtml = config.icon.startsWith('<i') ? config.icon : `<img src="${config.icon}" alt="${config.name} Icon" class="h-6 w-auto mr-3">`;

                return `
                    <div class="flex justify-between items-center px-4 py-4 border-b border-[#252525] last:border-b-0">
                        <div class="flex items-center text-lg text-white">
                            ${iconHtml}
                            ${config.name}
                            ${isPrimary ? '<span class="text-xs text-yellow-400 ml-2 font-normal">(Primary)</span>' : ''}
                        </div>
                        <div class="flex items-center gap-2"> <!-- Container for buttons -->
                            ${showSetPrimaryButton ? 
                                `<button class="btn-toolbar-style btn-primary-override" data-provider-id="${id}" data-action="set-primary" style="padding: 0.5rem 0.75rem;">
                                    <i class="fa-solid fa-star mr-1"></i> Set Primary
                                </button>` : ''
                            }
                            ${canUnlink ? 
                                `<button class="btn-toolbar-style text-red-400 hover:border-red-600 hover:text-red-600" data-provider-id="${id}" data-action="unlink" style="padding: 0.5rem 0.75rem;">
                                    <i class="fa-solid fa-unlink mr-1"></i> Unlink
                                </button>` : 
                                // Show "Cannot Unlink" if not able to unlink (e.g., it's the only provider, or it's password and primary)
                                (providerData.length === 1 || (id === 'password' && primaryProviderId === 'password')) ? 
                                    `<span class="text-xs text-custom-light-gray font-light ml-4">Cannot Unlink</span>` : ''
                            }
                        </div>
                    </div>
                `;
            }).join('');

            // Filter out already linked social providers for the linking list
            const linkedIds = providerData.map(p => p.providerId);
            let availableProvidersHtml = Object.keys(PROVIDER_CONFIG)
                .filter(id => id !== 'password' && !linkedIds.includes(id))
                .map(id => {
                    const config = PROVIDER_CONFIG[id];
                    let iconHtml = config.icon.startsWith('<i') ? config.icon : `<img src="${config.icon}" alt="${config.name} Icon" class="h-6 w-auto mr-3">`;

                    return `
                        <div class="flex justify-between items-center px-4 py-4 border-b border-[#252525] last:border-b-0">
                            <div class="flex items-center text-lg text-white">
                                ${iconHtml}
                                ${config.name}
                            </div>
                            <button class="btn-toolbar-style btn-primary-override" data-provider-id="${id}" data-action="link" style="padding: 0.5rem 0.75rem;">
                                <i class="fa-solid fa-link mr-1"></i> Link Provider
                            </button>
                        </div>
                    `;
                }).join('');
                
            if (availableProvidersHtml === '') {
                availableProvidersHtml = `
                    <div class="px-4 py-4">
                        <p class="text-sm text-gray-500 text-center">All available social providers are linked.</p>
                    </div>
                `;
            }


            // --- Account Deletion Section ---
            let deletionContent = '';
            
            if (!primaryProviderId) { // No primary provider found
                deletionContent = `
                    <h3 class="text-xl font-bold text-white mb-2 mt-8">Delete Account</h3>
                    <div id="deletionSection" class="settings-box w-full bg-red-900/10 border-red-700/50 p-4">
                        <p class="text-sm font-light text-red-300 mb-3">
                            <i class="fa-solid fa-triangle-exclamation mr-1"></i> 
                            WARNING: Deleting your account is permanent. No primary authentication method found. Please contact support.
                        </p>
                    </div>
                `;
            } else if (primaryProviderId === 'password') {
                deletionContent = `
                    <h3 class="text-xl font-bold text-white mb-2 mt-8">Delete Account</h3>
                    <div id="deletionSection" class="settings-box w-full bg-red-900/10 border-red-700/50 p-4">
                        <p class="text-sm font-light text-red-300 mb-3">
                            <i class="fa-solid fa-triangle-exclamation mr-1"></i> 
                            WARNING: Deleting your account is permanent and cannot be undone.
                        </p>
                        
                        <div id="passwordDeletionStep1">
                            <label for="deletePasswordInput" class="block text-red-300 text-sm font-light mb-2">Confirm Current Password</label>
                            <input type="password" id="deletePasswordInput" placeholder="Current Password" class="input-text-style w-full bg-red-900/20 border-red-700/50 mb-3">
                            
                            <label for="deleteConfirmText" class="block text-red-300 text-sm font-light mb-2">Type "Delete My Account" to confirm (Case-insensitive)</label>
                            <input type="text" id="deleteConfirmText" placeholder="Delete My Account" class="input-text-style w-full bg-red-900/20 border-red-700/50">
                            
                            <div class="flex justify-between items-center pt-4">
                                <p id="deleteMessage" class="general-message-area text-sm"></p>
                                <button id="finalDeleteBtn" class="btn-toolbar-style btn-primary-override-danger w-48" disabled style="padding: 0.5rem 0.75rem;">
                                     <i class="fa-solid fa-trash mr-1"></i> Delete Account
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            } else {
                deletionContent = `
                    <h3 class="text-xl font-bold text-white mb-2 mt-8">Delete Account</h3>
                    <div id="deletionSection" class="settings-box w-full bg-red-900/10 border-red-700/50 p-4">
                        <p class="text-sm font-light text-red-300 mb-3">
                            <i class="fa-solid fa-triangle-exclamation mr-1"></i> 
                            WARNING: Deleting your account is permanent. You must re-authenticate with ${PROVIDER_CONFIG[primaryProviderId].name} to proceed.
                        </p>
                        
                        <div class="flex justify-between items-center pt-2">
                            <p id="deleteMessage" class="general-message-area text-sm"></p>
                            <button id="reauthenticateBtn" class="btn-toolbar-style w-48 btn-primary-override" data-provider-id="${primaryProviderId}" style="padding: 0.5rem 0.75rem;">
                                 <i class="fa-solid fa-key mr-1"></i> Re-authenticate
                            </button>
                            <button id="finalDeleteBtn" class="btn-toolbar-style btn-primary-override-danger w-48 hidden" style="padding: 0.5rem 0.75rem;">
                                 <i class="fa-solid fa-trash mr-1"></i> Delete Account
                            </button>
                        </div>
                    </div>
                `;
            }

            // --- Combined HTML for Account Management ---
            return `
                <h3 class="text-xl font-bold text-white mb-2 mt-8">Linked Providers</h3>
                
                <div id="accountMessage" class="general-message-area text-sm mb-2"></div>

                <div class="settings-box w-full mb-4 p-0" data-section="linked-providers">
                    ${linkedProvidersHtml}
                </div>
                
                <h3 class="text-xl font-bold text-white mb-2">Link New Providers</h3>
                <div class="settings-box w-full flex flex-col gap-0 p-0">
                    ${availableProvidersHtml}
                </div>
                
                ${deletionContent}
            `;
        }


        /**
         * Generates the HTML for the "General Settings" section.
         */
        function getGeneralContent(currentUsername, changesRemaining, changesThisMonth, currentMonthName, isEmailPasswordUser, providerData) {
             const changesUsed = changesThisMonth;
             
             // Conditionally generate the password section HTML
             let passwordSectionHtml = '';
             if (isEmailPasswordUser) {
                 passwordSectionHtml = getChangePasswordSection();
             }

             return `
                 <h2 class="text-3xl font-bold text-white mb-6">General Settings</h2>
                 
                 <div class="w-full">
                    
                    <div class="flex justify-between items-center mb-4 settings-box p-4">
                        <p class="text-sm font-light text-gray-300">
                           <i class="fa-solid fa-calendar-alt mr-2 text-yellow-500"></i>
                           Changes this month (<span class="text-emphasis text-yellow-300">${currentMonthName}</span>):
                        </p>
                        <span class="text-lg font-semibold ${changesRemaining > 0 ? 'text-green-400' : 'text-red-400'}">
                            ${changesUsed}/${MAX_CHANGES} used
                        </span>
                    </div>

                    <h3 class="text-xl font-bold text-white mb-2">Account Username</h3>
                    
                    <div id="usernameSection" class="settings-box transition-all duration-300 p-4">
                        
                        <div id="viewMode" class="flex justify-between items-center">
                            <p class="text-lg text-gray-400 leading-relaxed">
                                Current: <span id="currentUsernameText" class="text-emphasis text-blue-400">${currentUsername}</span>
                            </p>
                            <button id="enterEditModeBtn" class="btn-toolbar-style" style="padding: 0.5rem 0.75rem;">
                                 <i class="fa-solid fa-pen-to-square mr-1"></i> Change
                            </button>
                        </div>

                        <div id="editMode" class="hidden flex-col gap-3 pt-4 border-t border-[#252525]">
                            <label for="newUsernameInput" class="block text-gray-400 text-sm font-light">New Username</label>
                            <input type="text" id="newUsernameInput" value="${currentUsername}" maxlength="${MAX_LENGTH}"
                                   class="input-text-style w-full" 
                                   placeholder="${MIN_LENGTH}-${MAX_LENGTH} characters, only allowed symbols">
                            
                            <div class="flex justify-between items-center pt-2">
                                <p class="text-xs text-gray-500 font-light whitespace-nowrap">
                                    Length: <span id="minLength" class="font-semibold text-gray-400">${MIN_LENGTH}</span>/<span id="charCount" class="font-semibold text-gray-400">${currentUsername.length}</span>/<span id="maxLength" class="font-semibold text-gray-400">${MAX_LENGTH}</span>
                                </p>
                                
                                <div class="flex gap-2">
                                    <button id="applyUsernameBtn" class="btn-toolbar-style btn-primary-override w-24 transition-opacity duration-300" disabled style="padding: 0.5rem 0.75rem;">
                                        <i class="fa-solid fa-check"></i> Apply
                                    </button>
                                    <button id="cancelEditBtn" class="btn-toolbar-style w-24 transition-opacity duration-300" style="padding: 0.5rem 0.75rem;">
                                        <i class="fa-solid fa-xmark"></i> Cancel
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div id="usernameChangeMessage" class="general-message-area text-sm"></div>
                </div>
                
                ${passwordSectionHtml}
             `;
         }



        
        /**
         * NEW: Generates the HTML for the "Personalization" section.
         */
        function getPersonalizationContent() {
             return `
                <style>
                    /* Custom Range Slider Styling */
                    .mac-slider {
                        -webkit-appearance: none;
                        appearance: none;
                        background: transparent; /* Track color handled by Tailwind classes */
                    }
                    .mac-slider::-webkit-slider-thumb {
                        -webkit-appearance: none;
                        appearance: none;
                        width: 20px;
                        height: 20px;
                        background: black;
                        border: 2px solid white;
                        border-radius: 50%;
                        cursor: pointer;
                        margin-top: -6px; /* Adjust based on track height */
                    }
                    .mac-slider::-moz-range-thumb {
                        width: 20px;
                        height: 20px;
                        background: black;
                        border: 2px solid white;
                        border-radius: 50%;
                        cursor: pointer;
                    }
                    .mac-slider::-webkit-slider-runnable-track {
                        height: 0.5rem;
                        border-radius: 0.5rem;
                        background: #374151; /* gray-700 */
                    }
                    .mac-slider::-moz-range-track {
                        height: 0.5rem;
                        border-radius: 0.5rem;
                        background: #374151;
                    }
                    /* Live preview scaling for orientation mode */
                    .mac-preview-scaled {
                        transition: transform 0.3s ease;
                        transform-origin: center;
                    }
                </style>
                <h2 class="text-3xl font-bold text-white mb-6">Personalization</h2>
                
                <div class="w-full">
                    <!-- PROFILE PICTURE SECTION -->
                    <h3 class="text-xl font-bold text-white mb-2">Profile Picture</h3>
                    <div id="pfpSection" class="settings-box transition-all duration-300 p-4 mb-8">
                        <p class="text-sm font-light text-gray-400 mb-4">
                            Choose how you appear across the site.
                        </p>
                        
                        <div class="flex flex-col gap-4">
                            <!-- Mode Selection Dropdown -->
                            <div>
                                <label for="pfpModeSelect" class="block text-gray-400 text-sm font-light mb-2">Display Mode</label>
                                <select id="pfpModeSelect" class="input-select-style">
                                    <option value="google">Use Google Profile Picture</option>
                                    <option value="mibi">Use Mibi Avatar</option>
                                    <option value="letter">Use Letter Avatar</option>
                                    <option value="custom">Upload Custom Image</option>
                                </select>
                            </div>

                            <!-- Letter Avatar Settings (Hidden by default) -->
                            <div id="pfpLetterSettings" class="hidden flex flex-col gap-4 mt-2">
                                <p class="text-sm font-light text-gray-400 mb-4">
                                    Create a simple letter-based avatar.
                                </p>
                                
                                <div class="flex flex-col items-center gap-6">
                                    <canvas id="letterCanvas" width="200" height="200" class="rounded-full shadow-lg border border-[#333]"></canvas>
                                    
                                    <div class="w-full">
                                        <label class="block text-gray-400 text-sm font-light mb-2">Letter</label>
                                        <div class="grid grid-cols-9 gap-2 mb-4" id="letterPicker">
                                            <!-- Generated by JS -->
                                        </div>
                                    </div>

                                    <div class="w-full">
                                        <label class="block text-gray-400 text-sm font-light mb-2">Background Color</label>
                                        <div class="grid grid-cols-7 gap-2" id="colorPicker">
                                            <!-- Generated by JS -->
                                        </div>
                                    </div>
                                    
                                    <button id="saveLetterPfpBtn" class="btn-toolbar-style btn-primary-override px-6 py-2 rounded-xl mt-4">
                                        <i class="fa-solid fa-check mr-2"></i> Save Letter Avatar
                                    </button>
                                </div>
                                <style>
                                  .letterSquare,
                                  .colorSquare {
                                      height: 30px;
                                      cursor: pointer;
                                      display: flex;
                                      justify-content: center;
                                      align-items: center;
                                      border-radius: 0.5rem;
                                      transition: all 0.2s;
                                      border: 2px solid transparent;
                                  }
                                  .letterSquare:hover, .colorSquare:hover {
                                      transform: scale(1.1);
                                  }
                                  .letterSquare.selected, .colorSquare.selected {
                                      border-color: white;
                                      box-shadow: 0 0 0 2px #4f46e5;
                                  }
                                  .letterSquare {
                                      background-color: #252525;
                                      color: #ffffff;
                                      font-weight: bold;
                                  }
                                </style>
                            </div>

                            <!-- Mibi Avatar Settings (Hidden by default) -->
                            <div id="pfpMibiSettings" class="hidden flex flex-col gap-4 mt-2">
                                <p class="text-sm font-light text-gray-400 mb-4">
                                    Create your custom Mibi Avatar!
                                </p>
                                <button id="open-mac-menu-btn" class="btn-toolbar-style btn-primary-override">
                                    <i class="fa-solid fa-paintbrush mr-2"></i> Open Mibi Avatar Creator
                                </button>
                                
                                <!-- MAC Modal -->
                                <div id="mibi-mac-menu" class="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50 hidden backdrop-blur-sm">
                                    <div class="relative bg-black rounded-xl shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden border border-[#333]">
                                        
                                        <!-- Header -->
                                        <div class="flex justify-between items-center p-6 border-b border-[#333] bg-black">
                                            <h3 class="text-2xl font-bold text-white">Mibi Avatar Creator</h3>
                                            <button id="mac-close-x-btn" class="btn-toolbar-style w-10 h-10 flex items-center justify-center p-0">
                                                <i class="fa-solid fa-xmark fa-xl"></i>
                                            </button>
                                        </div>
                                        
                                        <!-- Main Content Area (Split View) -->
                                        <div class="flex flex-grow overflow-hidden relative">
                                            
                                            <!-- LEFT: Live Preview -->
                                            <div id="mac-preview-wrapper" class="w-1/2 flex flex-col items-center justify-center bg-[#0a0a0a] p-8 border-r border-[#333] transition-all duration-500 ease-in-out z-10">
                                                <div class="relative h-64 md:h-80 aspect-square rounded-full overflow-hidden border-4 border-[#333] shadow-lg mb-6 transition-all duration-300 hover:border-dashed hover:border-white cursor-pointer flex-shrink-0" id="mac-preview-container" style="aspect-ratio: 1/1;">
                                                    <!-- Background (Static) -->
                                                    <div id="mac-preview-bg" class="absolute inset-0 w-full h-full transition-colors duration-300"></div>
                                                    
                                                    <!-- Avatar Layers Container (Rotates/Scales/Moves) -->
                                                    <div id="mac-layers-container" class="absolute inset-0 w-full h-full transition-transform duration-75 ease-out origin-center pointer-events-none">
                                                        <img id="mac-layer-head" src="../mibi-avatars/head.png" class="absolute inset-0 w-full h-full object-contain z-10">
                                                        <img id="mac-layer-eyes" class="absolute inset-0 w-full h-full object-contain z-20 hidden">
                                                        <img id="mac-layer-mouth" class="absolute inset-0 w-full h-full object-contain z-20 hidden">
                                                        <img id="mac-layer-hat" class="absolute inset-0 w-full h-full object-contain z-30 hidden">
                                                    </div>
                                                </div>
                                                
                                                <div id="mac-sliders-container" class="hidden flex-col gap-6 w-full max-w-xs transition-opacity duration-300 opacity-0">
                                                    <div class="flex flex-col gap-2">
                                                        <label class="text-xs text-gray-400 uppercase tracking-wider font-bold">Size</label>
                                                        <input type="range" id="mac-size-slider" min="50" max="150" value="100" list="mac-size-ticks" class="mac-slider w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer">
                                                        <datalist id="mac-size-ticks">
                                                            <option value="100"></option>
                                                        </datalist>
                                                    </div>
                                                    <div class="flex flex-col gap-2">
                                                        <label class="text-xs text-gray-400 uppercase tracking-wider font-bold">Rotation</label>
                                                        <input type="range" id="mac-rotation-slider" min="-180" max="180" value="0" list="mac-rotation-ticks" class="mac-slider w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer">
                                                        <datalist id="mac-rotation-ticks">
                                                            <option value="0"></option>
                                                        </datalist>
                                                    </div>
                                                    <p class="text-center text-gray-500 text-xs mt-2"><i class="fa-solid fa-hand-pointer mr-1"></i> Drag avatar to position</p>
                                                </div>
                                                
                                                <p class="text-gray-500 text-sm font-mono mt-2" id="mac-preview-label">Click preview to adjust orientation</p>
                                            </div>

                                            <!-- RIGHT: Controls & Options -->
                                            <div id="mac-controls-wrapper" class="w-1/2 flex flex-col bg-black transition-transform duration-500 ease-in-out translate-x-0">
                                                
                                                <!-- Tabs -->
                                                <div class="flex border-b border-[#333]">
                                                    <button class="mac-tab-btn flex-1 py-4 text-gray-400 hover:text-white hover:bg-[#252525] transition-colors border-b-2 border-transparent font-medium active-tab" data-tab="hats">
                                                        <i class="fa-solid fa-hat-wizard mr-2"></i> Hats
                                                    </button>
                                                    <button class="mac-tab-btn flex-1 py-4 text-gray-400 hover:text-white hover:bg-[#252525] transition-colors border-b-2 border-transparent font-medium" data-tab="eyes">
                                                        <i class="fa-solid fa-eye mr-2"></i> Eyes
                                                    </button>
                                                    <button class="mac-tab-btn flex-1 py-4 text-gray-400 hover:text-white hover:bg-[#252525] transition-colors border-b-2 border-transparent font-medium" data-tab="mouths">
                                                        <i class="fa-solid fa-face-smile mr-2"></i> Mouths
                                                    </button>
                                                    <button class="mac-tab-btn flex-1 py-4 text-gray-400 hover:text-white hover:bg-[#252525] transition-colors border-b-2 border-transparent font-medium" data-tab="bg">
                                                        <i class="fa-solid fa-palette mr-2"></i> Color
                                                    </button>
                                                </div>

                                                <!-- Options Grid (Scrollable) -->
                                                <div class="flex-grow overflow-y-auto p-6 custom-scrollbar" id="mac-options-container">
                                                    <!-- Dynamic Content Loaded Here -->
                                                    <div class="grid grid-cols-3 gap-4" id="mac-grid">
                                                        <!-- JS populates this -->
                                                    </div>
                                                </div>

                                            </div>
                                        </div>
                                        
                                        <!-- Footer Actions -->
                                        <div class="p-6 border-t border-[#333] bg-black flex justify-end gap-4 items-center">
                                            <button id="mac-reset-btn" class="btn-toolbar-style mr-auto px-4 py-2 rounded-xl" title="Reset Avatar">
                                                <i class="fa-solid fa-rotate-left"></i>
                                            </button>
                                            <button id="mac-cancel-btn" class="btn-toolbar-style px-6 py-2 rounded-xl">Cancel</button>
                                            <button id="mac-confirm-btn" class="btn-toolbar-style btn-primary-override px-6 py-2 rounded-xl">
                                                <i class="fa-solid fa-check mr-2"></i> Confirm Avatar
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <!-- Custom Upload Settings (Hidden by default) -->
                            <div id="pfpCustomSettings" class="hidden mt-2">
                                <div class="flex items-center gap-4">
                                    <!-- Preview -->
                                    <div class="w-16 h-16 rounded-full overflow-hidden border border-gray-600 flex-shrink-0 bg-black relative">
                                        <img id="customPfpPreview" src="" class="w-full h-full object-cover" style="display: none;">
                                        <div id="customPfpPlaceholder" class="w-full h-full flex items-center justify-center text-gray-600">
                                            <i class="fa-solid fa-user"></i>
                                        </div>
                                    </div>
                                    
                                    <!-- Upload Button -->
                                    <div>
                                        <button id="uploadPfpBtn" class="btn-toolbar-style btn-primary-override">
                                            <i class="fa-solid fa-upload mr-2"></i> Upload Image
                                        </button>
                                        <input type="file" id="pfpFileInput" accept="image/*" style="display: none;">
                                        <p class="text-xs text-gray-500 mt-1">Max size: 2MB. Images are cropped to square.</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        <div id="pfpMessage" class="general-message-area text-sm"></div>
                    </div>

                    <!-- THEME SECTION -->
                    <h3 class="text-xl font-bold text-white mb-2">Navigation Bar Theme</h3>
                    <div id="themeSection" class="settings-box transition-all duration-300 p-4">
                        <p class="text-sm font-light text-gray-400 mb-4">
                            Select a theme for your navigation bar. This setting is saved locally and will apply a live preview.
                        </p>
                        
                        <div id="theme-picker-container">
                            <div class="flex items-center justify-center p-8">
                                <i class="fa-solid fa-spinner fa-spin fa-2x text-gray-500"></i>
                            </div>
                        </div>
                        
                        <div id="themeMessage" class="general-message-area text-sm"></div>
                    </div>
                </div>
             `;
        }



        /**
         * Generates the HTML for the "About 4SP" section.
         */
        function getAboutContent() {
            return `
                <h2 class="text-3xl font-bold text-white mb-4">About 4SP (4simpleproblems)</h2>
                
                <div class="about-section-content">
                    <p class="text-lg text-gray-400 leading-relaxed">
                        <span class="text-emphasis">4SP (4simpleproblems)</span> is a <span class="text-emphasis">Student Toolkit and Entertainment website</span> designed to boost student productivity and provide useful resources. We aim to solve four core challenges that students face every day by integrating essential tools and engaging digital content into one seamless platform.
                    </p>
                    
                    <h3 class="text-xl font-bold text-white mt-6 mb-2">The Four Simple Problems We Address</h3>
                    <ul class="list-disc list-inside ml-4 text-lg text-gray-400 leading-relaxed">
                        <li>Providing a <span class="text-emphasis">digital leisure platform free of advertisements</span>.</li>
                        <li>Delivering a <span class="text-emphasis">student toolkit designed for accessibility and consistent availability</span>, bypassing typical institutional network restrictions.</li>
                        <li>Establishing a <span class="text-emphasis">free, comprehensive, and reliable entertainment and resource hub</span>.</li>
                        <li>Enforcing <span class="text-emphasis">internal governance and balance of power</span>: Administrative authority is strictly limited to necessary website management functions, and only the creator holds full administrative power, ensuring neutrality.</li>
                    </ul>

                    <p class="text-lg text-gray-400 mt-4 leading-relaxed">
                        Features currently include an <span class="text-emphasis">online notebook</span> in the Notes App for secure organization, a <span class="text-emphasis">live clock</span> on the dashboard, a <span class="text-emphasis">dictionary</span> for quick lookups, and more tools.
                    </p>
                    
                    <h3 class="text-xl font-bold text-white mt-6 mb-2">Version</h3>
                    <p class="text-gray-400">
                        Current Version: <span class="text-blue-400 text-emphasis">5.0.17</span>
                    </p>

                    <h3 class="text-xl font-bold text-white mt-6 mb-3">Connect & Support</h3>
                    <div class="social-link-group">
                        <a href="https://www.youtube.com/@4simpleproblems" target="_blank" class="btn-toolbar-style" title="YouTube">
                            <i class="fa-brands fa-youtube fa-lg mr-2"></i> YouTube
                        </a>
                        <a href="https://x.com/4simpleproblems" target="_blank" class="btn-toolbar-style" title="X (Twitter)">
                            <i class="fa-brands fa-x-twitter fa-lg mr-2"></i>X
                        </a>
                        <a href="https://buymeacoffee.com/4simpleproblems" target="_blank" class="btn-toolbar-style" title="Buy Me a Coffee">
                            <i class="fa-solid fa-mug-hot fa-lg mr-2"></i> Buy Me a Coffee
                        </a>
                        <a href="https://github.com/v5-4simpleproblems" target="_blank" class="btn-toolbar-style" title="GitHub">
                            <i class="fa-brands fa-github fa-lg mr-2"></i> Github
                        </a>
                    </div>
                    
                    <h3 class="text-xl font-bold text-white mt-6 mb-3">Legal Information</h3>
                    <div class="legal-buttons">
                        <a href="../legal.html#terms-of-service" class="btn-toolbar-style">Terms of Service</a>
                        <a href="../legal.html#privacy-policy" class="btn-toolbar-style">Privacy Policy</a>
                    </div>
                </div>
            `;
        }

        /**
         * Generates the HTML for the "Coming Soon" sections.
         */
        function getComingSoonContent(title) {
            return `
                <h2 class="text-3xl font-bold text-white mb-2">${title}</h2>
                <div style="flex-grow: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%;">
                    <p class="text-xl text-gray-500 italic">...Coming Soon...</p>
                    <i class="fa-solid fa-hourglass-start fa-5x text-gray-700 mt-4"></i>
                </div>
            `;
        }
        
        // Helper for refreshing the General Tab
        const refreshGeneralTab = () => {
            // Clear the current view state and re-render the General tab
            // This is necessary because currentUser.providerData needs to be fresh
            switchTab('general');
        };

        // --- Mibi Avatar Creator (MAC) Logic ---

        // Global state for Mibi Avatar parts (persisted in this scope)
        let mibiAvatarState = {
            eyes: '',
            mouths: '',
            hats: '',
            bgColor: '#3B82F6', // Default blue
            size: 100,
            rotation: 0,
            offsetX: 0,
            offsetY: 0
        };
        
        // Constants for Assets
        const MIBI_ASSETS = {
            eyes: ['default-eyes.png', 'glasses.png', 'odd.png'],
            mouths: ['default-mouth.png', 'drool.png', 'meh.png', 'no-clue.png', 'sad.png', 'wow.png'],
            hats: ['strawhat.png', 'tophat.png', 'partyhat.png', 'halo.png', 'toiletpaper.png'],
            colors: [
    // --- RAINBOW ORDER ---
    '#EF4444', // Red
    '#F97316', // Orange
    '#F59E0B', // Amber
    '#EAB308', // Yellow
    '#84CC16', // Lime
    '#22C55E', // Green
    '#14B8A6', // Teal
    '#06B6D4', // Cyan
    '#0EA5E9', // Sky
    '#3B82F6', // Blue
    '#6366F1', // Indigo
    '#7C3AED', // Violet
    '#A855F7', // Purple
    '#E879F9', // Fuchsia
    '#EC4899', // Pink
    '#F43F5E', // Rose
    '#FFFFFF'  // White
]
        };

        const updateMibiPreview = () => {
            const bgEl = document.getElementById('mac-preview-bg');
            const layersContainer = document.getElementById('mac-layers-container'); // New container for transforms
            const eyesEl = document.getElementById('mac-layer-eyes');
            const mouthEl = document.getElementById('mac-layer-mouth');
            const hatEl = document.getElementById('mac-layer-hat');
            
            if (!bgEl || !layersContainer) return;

            // Update BG
            bgEl.style.backgroundColor = mibiAvatarState.bgColor;
            
            // Update Transforms (using percentages for translate)
            const scale = mibiAvatarState.size / 100;
            layersContainer.style.transform = `translate(${mibiAvatarState.offsetX}%, ${mibiAvatarState.offsetY}%) rotate(${mibiAvatarState.rotation}deg) scale(${scale})`;

            // Update Layers
            if (mibiAvatarState.eyes) {
                eyesEl.src = `../mibi-avatars/eyes/${mibiAvatarState.eyes}`;
                eyesEl.classList.remove('hidden');
            } else {
                eyesEl.classList.add('hidden');
            }
            
            if (mibiAvatarState.mouths) {
                mouthEl.src = `../mibi-avatars/mouths/${mibiAvatarState.mouths}`;
                mouthEl.classList.remove('hidden');
            } else {
                mouthEl.classList.add('hidden');
            }

            if (mibiAvatarState.hats) {
                hatEl.src = `../mibi-avatars/hats/${mibiAvatarState.hats}`;
                hatEl.classList.remove('hidden');
            } else {
                hatEl.classList.add('hidden');
            }
        };

        const renderMacGrid = (category) => {
            const grid = document.getElementById('mac-grid');
            grid.innerHTML = ''; // Clear existing

            if (category === 'bg') {
                // Switch to Flex for Colors (Wrapping, no scrollbar)
                grid.className = 'flex flex-wrap gap-2 justify-center p-2';

                // Color Palette
                MIBI_ASSETS.colors.forEach(color => {
                    const btn = document.createElement('button');
                    const isSelected = mibiAvatarState.bgColor === color;
                    // Style: Match X button (w-10 h-10, rounded-xl i.e. 0.75rem) + flex-shrink-0
                    btn.className = `w-10 h-10 rounded-xl shadow-sm transition-transform hover:scale-110 focus:outline-none border-2 flex-shrink-0 ${isSelected ? 'border-white' : 'border-transparent'} hover:border-dashed hover:border-white`;
                    btn.style.backgroundColor = color;
                    
                    btn.onclick = () => {
                        mibiAvatarState.bgColor = color;
                        updateMibiPreview();
                        renderMacGrid('bg'); // Re-render to update selection ring
                    };
                    grid.appendChild(btn);
                });
                // Add custom picker
                const customWrapper = document.createElement('div');
                // Match size and roundness + flex-shrink-0
                customWrapper.className = 'w-10 h-10 rounded-xl bg-[#333] flex items-center justify-center cursor-pointer hover:bg-[#444] relative overflow-hidden border-2 border-transparent hover:border-dashed hover:border-white flex-shrink-0';
                customWrapper.innerHTML = '<i class="fa-solid fa-eye-dropper text-white text-sm"></i><input type="color" class="absolute inset-0 opacity-0 cursor-pointer w-full h-full">';
                const input = customWrapper.querySelector('input');
                input.oninput = (e) => {
                    mibiAvatarState.bgColor = e.target.value;
                    updateMibiPreview();
                };
                grid.appendChild(customWrapper);

            } else {
                // Reset to Grid for Assets
                grid.className = 'grid grid-cols-3 gap-4';
                
                // "None" Option - ONLY for Hats
                if (category === 'hats') {
                    const noneBtn = document.createElement('div');
                    // Light grey background (bg-gray-200), More rounded (rounded-2xl)
                    noneBtn.className = `bg-gray-200 rounded-2xl p-2 flex flex-col items-center justify-center cursor-pointer border-2 hover:border-dashed hover:border-black transition-all ${!mibiAvatarState[category] ? 'border-black' : 'border-transparent'}`;
                    noneBtn.innerHTML = `<i class="fa-solid fa-ban fa-2x text-gray-600"></i>`;
                    noneBtn.onclick = () => {
                        mibiAvatarState[category] = '';
                        updateMibiPreview();
                        renderMacGrid(category);
                    };
                    grid.appendChild(noneBtn);
                }

                // Asset Options
                const files = MIBI_ASSETS[category] || [];
                files.forEach(file => {
                    const item = document.createElement('div');
                    const isSelected = mibiAvatarState[category] === file;
                    // Light grey background (bg-gray-200), More rounded (rounded-2xl)
                    item.className = `bg-gray-200 rounded-2xl p-2 flex flex-col items-center justify-center cursor-pointer border-2 hover:border-dashed hover:border-black transition-all ${isSelected ? 'border-black' : 'border-transparent'}`;
                    
                    item.innerHTML = `
                        <img src="../mibi-avatars/${category}/${file}" class="w-16 h-16 object-contain">
                    `;
                    
                    item.onclick = () => {
                        mibiAvatarState[category] = file;
                        updateMibiPreview();
                        renderMacGrid(category);
                    };
                    grid.appendChild(item);
                });
            }
        };

                        const preloadMibiAssets = () => {

                            const categories = ['eyes', 'mouths', 'hats'];

                            categories.forEach(cat => {

                                const files = MIBI_ASSETS[cat] || [];

                                files.forEach(file => {

                                    const img = new Image();

                                    img.src = `../mibi-avatars/${cat}/${file}`;

                                });

                            });

                        };

                

                        const setupMacMenuListeners = () => {

                            // Preload assets for faster loading

                            preloadMibiAssets();

                

                            const openBtn = document.getElementById('open-mac-menu-btn');

                            const menu = document.getElementById('mibi-mac-menu');

                            const closeBtn = document.getElementById('mac-close-x-btn');

                            const cancelBtn = document.getElementById('mac-cancel-btn');

                            const confirmBtn = document.getElementById('mac-confirm-btn');

                            const resetBtn = document.getElementById('mac-reset-btn'); // NEW

                            const tabBtns = document.querySelectorAll('.mac-tab-btn');

                            const pfpModeSelect = document.getElementById('pfpModeSelect');

                            const pfpMessage = document.getElementById('pfpMessage');

                            

                            // Orientation Mode Elements

                            const previewContainer = document.getElementById('mac-preview-container');

                            const previewWrapper = document.getElementById('mac-preview-wrapper'); // The w-1/2 container

                            const controlsWrapper = document.getElementById('mac-controls-wrapper'); // The w-1/2 menu container

                            const slidersContainer = document.getElementById('mac-sliders-container');

                            const sizeSlider = document.getElementById('mac-size-slider');

                            const rotationSlider = document.getElementById('mac-rotation-slider');

                            const macPreviewLabel = document.getElementById('mac-preview-label'); // NEW: Reference to the label

                

                            if (!openBtn || !menu) return;

                

                            window.Mibi_ASSETS = MIBI_ASSETS; 

                            

                                        let isOrientationMode = false;

                            

                                        let currentTab = 'hats'; // Track current tab

                            

                                        let orientationSnapshot = null; // Store state for reverting

                            

                            

                            

                                        const openMenu = () => {

                            

                                            menu.classList.remove('hidden');

                            

                                            // Default selections if empty

                            

                                            if (!mibiAvatarState.eyes) mibiAvatarState.eyes = MIBI_ASSETS.eyes[0];

                            

                                            if (!mibiAvatarState.mouths) mibiAvatarState.mouths = MIBI_ASSETS.mouths[0];

                            

                                            

                            

                                            // Reset Orientation Mode state on open

                            

                                            exitOrientationMode(false); // Don't revert on initial open reset

                            

                                            updateMibiPreview();

                            

                                            

                            

                                            // Trigger click on first tab (or current) to load it

                            

                                            // Default to Hats

                            

                                            document.querySelector(`.mac-tab-btn[data-tab="${currentTab}"]`)?.click();

                            

                                        };

                            

                            

                            

                                        const closeMenu = () => {

                            

                                            menu.classList.add('hidden');

                            

                                        };

                            

                                        

                            

                                        // --- Orientation Mode Logic ---

                            

                                                    const enterOrientationMode = () => {
    if (isOrientationMode) return;
    isOrientationMode = true;

    // Snapshot state for revert
    orientationSnapshot = { ...mibiAvatarState };

    // Animate UI
    // Parent changes layout to row
    previewWrapper.classList.remove('w-1/2', 'flex-col', 'items-center', 'justify-center');
    previewWrapper.classList.add('w-full', 'flex-row', 'justify-start', 'items-start', 'gap-x-12', 'pl-16'); 

    // Explicitly force width and height to be equal to fix pill bug
    const computedHeight = previewContainer.offsetHeight; 
    
    // --- FIX START ---
    previewContainer.style.width = `${computedHeight}px`;
    previewContainer.style.height = `${computedHeight}px`;
    // Add min-width to prevent flexbox crushing
    previewContainer.style.minWidth = `${computedHeight}px`; 
    previewContainer.style.minHeight = `${computedHeight}px`;
    // --- FIX END ---

    previewContainer.style.transform = ''; 

    // --- FIX START ---
    // DO NOT remove 'flex-shrink-0'. We remove 'w-2/3' and margins, but KEEP flex-shrink-0
    previewContainer.classList.remove('mt-16', 'w-2/3'); 
    previewContainer.classList.add('flex-shrink-0'); // Explicitly force it not to shrink
    // --- FIX END ---

    // Adjust sliders container
    slidersContainer.classList.remove('hidden', 'opacity-0', 'max-w-xs', 'w-1/3', 'ml-4');
    slidersContainer.classList.add('flex', 'opacity-100', 'flex-grow', 'mt-16', 'p-4'); 

    controlsWrapper.classList.add('translate-x-full', 'w-0', 'overflow-hidden', 'p-0'); 
    controlsWrapper.classList.remove('translate-x-0', 'w-1/2');

    // Hide "Click preview" text
    macPreviewLabel.classList.add('hidden');

    // Update Button
    confirmBtn.innerHTML = '<i class="fa-solid fa-check mr-2"></i> Confirm Orientation';

    // Sync sliders
    sizeSlider.value = mibiAvatarState.size;
    rotationSlider.value = mibiAvatarState.rotation;
};

                            

                                                    

                            

                                                    const exitOrientationMode = (shouldRevert = false) => {

                            

                                                        isOrientationMode = false;

                            

                                                        

                            

                                                        if (shouldRevert && orientationSnapshot) {

                            

                                                            mibiAvatarState = { ...orientationSnapshot };

                            

                                                            updateMibiPreview();

                            

                                                        }

                            

                                                        orientationSnapshot = null;

                            

                                                        

                            

                                                        // Revert UI

                            

                                                        previewWrapper.classList.add('w-1/2', 'flex-col', 'items-center', 'justify-center'); // Revert to default layout

                            

                                                        previewWrapper.classList.remove('w-full', 'flex-row', 'justify-start', 'items-start', 'gap-x-12', 'pl-16');

                            

                                                        

                            

                                                        // Restore preview container to default (no dynamic styles/classes)

                            

                                                        previewContainer.style.transform = '';

                            

                                                        previewContainer.style.width = ''; // Remove explicitly set width

                            

                                                        previewContainer.style.height = ''; // Remove explicitly set height


                                                        previewContainer.style.minWidth = ''; // Clear min-width
                                                        previewContainer.style.minHeight = ''; // Clear min-height

                            

                                                        previewContainer.classList.remove('mt-16', 'w-2/3', 'flex-shrink-0'); // Ensure these are removed

                                                        previewContainer.classList.add('flex-shrink-0');

                                                        // Default width/height are handled by initial HTML classes `h-64 md:h-80 aspect-square rounded-full`

                            

                                        

                            

                                                        // Restore sliders container

                            

                                                        slidersContainer.classList.add('hidden', 'opacity-0', 'max-w-xs');

                            

                                                        slidersContainer.classList.remove('flex', 'opacity-100', 'flex-grow', 'mt-16', 'p-4'); // Remove dynamic positioning and padding

                            

                                        

                            

                                        

                            

                                                        controlsWrapper.classList.remove('translate-x-full', 'w-0', 'overflow-hidden', 'p-0');

                            

                                                        controlsWrapper.classList.add('translate-x-0', 'w-1/2');

                            

                                        

                            

                                                        // Show "Click preview" text

                            

                                                        macPreviewLabel.classList.remove('hidden');

                            

                                                        

                            

                                                        // Update Button

                            

                                                        confirmBtn.innerHTML = '<i class="fa-solid fa-check mr-2"></i> Confirm Avatar';

                            

                                                    };

                    

                    // Preview Click -> Enter Mode

                    previewContainer.addEventListener('click', (e) => {

                        // Only enter orientation mode if click is not on a slider handle during dragging

                        if (!isOrientationMode) {

                            enterOrientationMode();

                        }

                    });

                    

                    // --- Drag Logic ---

                    let isDragging = false;

                    let startX, startY, initialOffsetX, initialOffsetY;

                    

                    previewContainer.addEventListener('mousedown', (e) => {

                        if (!isOrientationMode) return;

                        isDragging = true;

                        startX = e.clientX;

                        startY = e.clientY;

                        initialOffsetX = mibiAvatarState.offsetX;

                        initialOffsetY = mibiAvatarState.offsetY;

                        previewContainer.style.cursor = 'grabbing';

                    });

                    

                    window.addEventListener('mousemove', (e) => {

                        if (!isDragging || !isOrientationMode) return;

                        

                        const rect = previewContainer.getBoundingClientRect();

                        const dx = e.clientX - startX;

                        const dy = e.clientY - startY;

                        

                        // Convert drag distance to percentage of container size

                        // Removed scale from here as preview is no longer scaled

                        const deltaXPercent = (dx / rect.width) * 100;

                        const deltaYPercent = (dy / rect.height) * 100;

                        

                        let newX = initialOffsetX + deltaXPercent;

                        let newY = initialOffsetY + deltaYPercent;

                        

                        // Clamp values (e.g. -60 to 60)

                        const CLAMP_LIMIT = 60;

                        newX = Math.max(-CLAMP_LIMIT, Math.min(CLAMP_LIMIT, newX));

                        newY = Math.max(-CLAMP_LIMIT, Math.min(CLAMP_LIMIT, newY));

        

                        mibiAvatarState.offsetX = newX;

                        mibiAvatarState.offsetY = newY;

                        

                        updateMibiPreview();

                    });

                    

                    window.addEventListener('mouseup', () => {

                        isDragging = false;

                        if (previewContainer) previewContainer.style.cursor = isOrientationMode ? 'grab' : 'pointer';

                    });

                    

                    // --- Slider Listeners ---

                    const snapThreshold = 5; // degrees/percent

                    sizeSlider.addEventListener('input', (e) => {

                        let value = parseInt(e.target.value);

                        if (Math.abs(value - 100) < snapThreshold) { // Snap to 100

                            value = 100;

                            e.target.value = 100; // Update visual slider position

                        }

                        mibiAvatarState.size = value;

                        updateMibiPreview();

                    });

                    

                    rotationSlider.addEventListener('input', (e) => {

                        let value = parseInt(e.target.value);

                        if (Math.abs(value - 0) < snapThreshold) { // Snap to 0

                            value = 0;

                            e.target.value = 0; // Update visual slider position

                        }

                        mibiAvatarState.rotation = value;

                        updateMibiPreview();

                    });

        

        

                    openBtn.onclick = openMenu;

                    closeBtn.onclick = closeMenu;

                    

                                cancelBtn.onclick = () => {

                    

                                    if (isOrientationMode) {

                    

                                        exitOrientationMode(true); // Revert changes

                    

                                    } else {

                    

                                        closeMenu();

                    

                                    }

                    

                                };

                    

                                

                    

                                // --- Reset Button Logic ---

                    

                                resetBtn.onclick = () => {

                    

                                    // Reset State to Defaults

                    

                                    mibiAvatarState = {

                    

                                        eyes: MIBI_ASSETS.eyes[0], // Default eyes

                    

                                        mouths: MIBI_ASSETS.mouths[0], // Default mouth

                    

                                        hats: '',

                    

                                        bgColor: '#FFFFFF', // Requested white default

                    

                                        size: 100,

                    

                                        rotation: 0,

                    

                                        offsetX: 0,

                    

                                        offsetY: 0

                    

                                    };

                    

                                    

                    

                                    // Update Visuals

                    

                                    updateMibiPreview();

                    

                                    

                    

                                    // Update Sliders

                    

                                    sizeSlider.value = 100;

                    

                                    rotationSlider.value = 0;

                    

                                    

                    

                                    // Re-render current tab (to update selection rings)

                    

                                    renderMacGrid(currentTab);

                    

                                };

                    

                    

                    

                                // Tab Switching Logic

                    

                                tabBtns.forEach(btn => {

                    

                                    btn.onclick = () => {

                    

                                        // Update UI

                    

                                        tabBtns.forEach(b => {

                    

                                            b.classList.remove('active-tab', 'text-white', 'border-blue-500');

                    

                                            b.classList.add('text-gray-400', 'border-transparent');

                    

                                        });

                    

                                        btn.classList.add('active-tab', 'text-white', 'border-blue-500');

                    

                                        btn.classList.remove('text-gray-400', 'border-transparent');

                    

                                        

                    

                                        // Track Tab

                    

                                        currentTab = btn.dataset.tab;

                    

                    

                    

                                        // Load Content

                    

                                        renderMacGrid(btn.dataset.tab);

                    

                                    };

                    

                                });

                    

                    

                    

                                // Confirm Action

                    

                                confirmBtn.onclick = async () => {

                    

                                    if (isOrientationMode) {

                    

                                        exitOrientationMode(false); // Keep changes

                    

                                        return;

                    

                                    }
                
                closeMenu();
                showMessage(pfpMessage, '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Saving Mibi Avatar...', 'warning');
                
                try {
                    const userDocRef = getUserDocRef(currentUser.uid);
                    
                    // Save to Firestore
                    await updateDoc(userDocRef, {
                        pfpType: 'mibi',
                        mibiConfig: mibiAvatarState
                    });
                    
                    // Update local dispatch for immediate feedback
                    const newUserData = {
                        pfpType: 'mibi',
                        mibiConfig: mibiAvatarState
                    };
                    
                    // Dispatch event so navigation bars update immediately
                    window.dispatchEvent(new CustomEvent('pfp-updated', { detail: newUserData }));
                    
                    showMessage(pfpMessage, 'Mibi Avatar saved successfully!', 'success');
                    
                    // Update dropdown to reflect choice
                    if (pfpModeSelect) {
                        // Logic to handle the custom dropdown implementation if it exists
                        pfpModeSelect.value = 'mibi';
                        // Trigger change event if needed, or manually update custom dropdown UI
                        const wrapper = pfpModeSelect.parentElement.querySelector('.custom-select-trigger');
                         if (wrapper) {
                             const option = Array.from(pfpModeSelect.options).find(o => o.value === 'mibi');
                             if(option) wrapper.innerHTML = `<span>${option.textContent}</span><div class="arrow"></div>`;
                         }
                    }

                } catch (error) {
                    console.error("Error saving Mibi avatar:", error);
                    showMessage(pfpMessage, 'Failed to save avatar. Please try again.', 'error');
                }
            };
        };

        // --- Utility: Custom Dropdown Setup ---
        function setupCustomDropdown(selectElement, onChangeCallback) {
            if (!selectElement) {
                console.error("setupCustomDropdown: selectElement is null.");
                return null; // Return null if the element doesn't exist
            }
            // Hide original select
            selectElement.style.display = 'none';
            
            // Create wrapper
            const wrapper = document.createElement('div');
            wrapper.className = 'custom-select-wrapper';
            selectElement.parentNode.insertBefore(wrapper, selectElement);
            wrapper.appendChild(selectElement);
            
            // Create custom structure
            const customSelect = document.createElement('div');
            customSelect.className = 'custom-select';
            
            const trigger = document.createElement('div');
            trigger.className = 'custom-select-trigger';
            
            // Helper to get option HTML with favicon
            const getOptionContentHtml = (option) => {
                const preset = urlChangerPresets.find(p => p.id === option.value);
                if (preset && preset.favicon) {
                    return `
                        <div class="custom-option-content">
                            <img src="${preset.favicon}" alt="${preset.name} Favicon">
                            <span>${option.textContent}</span>
                        </div>
                    `;
                }
                return `<span>${option.textContent}</span>`;
            };

            // Get initial text
            const selectedOption = selectElement.options[selectElement.selectedIndex];
            const initialHtml = selectedOption ? getOptionContentHtml(selectedOption) : '<span>Select...</span>';
            
            trigger.innerHTML = `${initialHtml}<div class="arrow"></div>`; // Use initialHtml here
            
            const optionsContainer = document.createElement('div');
            optionsContainer.className = 'custom-options';
            
            // Populate options
            Array.from(selectElement.options).forEach(option => {
                const customOption = document.createElement('div');
                customOption.className = 'custom-option' + (option.selected ? ' selected' : '');
                customOption.dataset.value = option.value;
                // --- MODIFICATION: Use innerHTML with favicon ---
                customOption.innerHTML = getOptionContentHtml(option); 
                
                customOption.addEventListener('click', function() {
                    // Update Trigger Text
                    trigger.innerHTML = `${this.innerHTML}<div class="arrow"></div>`; // Update trigger with selected option's full HTML
                    
                    // Update Classes
                    customSelect.classList.remove('open');
                    optionsContainer.querySelectorAll('.custom-option').forEach(opt => opt.classList.remove('selected'));
                    this.classList.add('selected');
                    
                    // Update Original Select
                    selectElement.value = this.dataset.value;
                    
                    // Trigger Callback
                    if (onChangeCallback) onChangeCallback(this.dataset.value);
                });
                
                optionsContainer.appendChild(customOption);
            });
            
            customSelect.appendChild(trigger);
            customSelect.appendChild(optionsContainer);
            wrapper.appendChild(customSelect);
            
            // Trigger Event
            trigger.addEventListener('click', function() {
                customSelect.classList.toggle('open');
            });
            
            // Close when clicking outside
            window.addEventListener('click', function(e) {
                if (!customSelect.contains(e.target)) {
                    customSelect.classList.remove('open');
                }
            });
            
            // Return an update function to refresh options dynamically
            return {
                refresh: () => {
                    // Clear existing options
                    optionsContainer.innerHTML = '';
                    // Re-populate
                    Array.from(selectElement.options).forEach(option => {
                        const customOption = document.createElement('div');
                        customOption.className = 'custom-option' + (option.selected ? ' selected' : '');
                        customOption.dataset.value = option.value;
                        // --- MODIFICATION: Use innerHTML with favicon ---
                        customOption.innerHTML = getOptionContentHtml(option);
                        
                        if (option.selected) {
                             trigger.innerHTML = `${getOptionContentHtml(option)}<div class="arrow"></div>`;
                        }

                        customOption.addEventListener('click', function() {
                            trigger.innerHTML = `${this.innerHTML}<div class="arrow"></div>`;
                            customSelect.classList.remove('open');
                            optionsContainer.querySelectorAll('.custom-option').forEach(opt => opt.classList.remove('selected'));
                            this.classList.add('selected');
                            selectElement.value = this.dataset.value;
                            if (onChangeCallback) onChangeCallback(this.dataset.value);
                        });
                        optionsContainer.appendChild(customOption);
                    });
                },
                // Helper to manually select value programmatically
                setValue: (value) => {
                    const optionToSelect = Array.from(selectElement.options).find(opt => opt.value === value);
                    if (optionToSelect) {
                        selectElement.value = value;
                        trigger.innerHTML = `${getOptionContentHtml(optionToSelect)}<div class="arrow"></div>`;
                        optionsContainer.querySelectorAll('.custom-option').forEach(opt => {
                            if (opt.dataset.value === value) opt.classList.add('selected');
                            else opt.classList.remove('selected');
                        });
                    }
                }
            };
        }

        /**
         * Loads user data, checks rate limit, and renders the General tab.
         */
        async function loadGeneralTab() {
            if (!currentUser) return; 

            // Check if user is using email/password authentication (providerId 'password')
            const isEmailPasswordUser = currentUser.providerData.some(
                (info) => info.providerId === 'password'
            );
            
            const userDocRef = getUserDocRef(currentUser.uid);
            let userDocSnap = await getDoc(userDocRef);

            if (!userDocSnap.exists()) {
                mainView.innerHTML = `<h2 class="text-3xl font-bold text-white mb-6">General Settings</h2><p class="text-red-400">Error: User data not found. Please log out and back in.</p>`;
                return;
            }

            let userData = userDocSnap.data();
            const today = new Date();
            const currentMonthNumber = today.getMonth() + 1; 
            const currentMonthName = today.toLocaleDateString('en-US', { month: 'long' }); 
            
            let changesThisMonth = userData.usernameChangesThisMonth || 0;
            let lastChangeMonth = userData.lastUsernameChangeMonth || 0;

            // --- Monthly Reset Logic ---
            if (currentMonthNumber !== lastChangeMonth) {
                changesThisMonth = 0;
                await updateDoc(userDocRef, {
                    usernameChangesThisMonth: 0,
                    lastUsernameChangeMonth: currentMonthNumber
                });
                userDocSnap = await getDoc(userDocRef);
                userData = userDocSnap.data(); 
            }
            
            const changesRemaining = MAX_CHANGES - changesThisMonth;

            // 1. Render the General Content
            mainView.innerHTML = getGeneralContent(
                userData.username, 
                changesRemaining, 
                changesThisMonth, 
                currentMonthName,
                isEmailPasswordUser, 
                currentUser.providerData // Pass provider info
            );
            
            // 2. Element References (Username Section)
            const viewMode = document.getElementById('viewMode');
            const editMode = document.getElementById('editMode');
            const enterEditModeBtn = document.getElementById('enterEditModeBtn');
            const cancelEditBtn = document.getElementById('cancelEditBtn');
            const applyUsernameBtn = document.getElementById('applyUsernameBtn');
            const newUsernameInput = document.getElementById('newUsernameInput');
            const messageElement = document.getElementById('usernameChangeMessage');
            const charCountElement = document.getElementById('charCount');
            const minLengthElement = document.getElementById('minLength');
            const maxLengthElement = document.getElementById('maxLength');

            // --- Username UI State Management Functions ---
            const setEditMode = (isEditing) => {
                showMessage(messageElement, '', 'success'); // Clear message
                
                if (isEditing) {
                    if (changesRemaining <= 0) {
                        showMessage(messageElement, `You have reached your limit of ${MAX_CHANGES} username changes for the current month.`, 'error'); 
                        return;
                    }
                    viewMode.classList.add('hidden');
                    editMode.classList.remove('hidden');
                    newUsernameInput.focus();
                    updateCounterAndValidation(); 
                } else {
                    editMode.classList.add('hidden');
                    viewMode.classList.remove('hidden');
                    newUsernameInput.value = userData.username; // Reset input value
                    applyUsernameBtn.disabled = true;
                }
            };

            const updateCounterAndValidation = () => {
                const newUsername = newUsernameInput.value.trim();
                const count = newUsername.length;
                
                charCountElement.textContent = count;
                
                const isValidLength = count >= MIN_LENGTH && count <= MAX_LENGTH;
                const isChanged = newUsername !== userData.username;
                
                // 1. Update counter colors
                minLengthElement.classList.toggle('text-red-400', count < MIN_LENGTH);
                maxLengthElement.classList.toggle('text-red-400', count > MAX_LENGTH);
                
                minLengthElement.classList.toggle('text-gray-400', count >= MIN_LENGTH);
                maxLengthElement.classList.toggle('text-gray-400', count <= MAX_LENGTH);
                
                charCountElement.classList.toggle('text-red-400', !isValidLength);
                charCountElement.classList.toggle('text-gray-400', isValidLength);


                // 2. Update button state
                applyUsernameBtn.disabled = !isChanged || !isValidLength || changesRemaining <= 0;
            };

            // --- Username Event Listeners ---
            enterEditModeBtn.addEventListener('click', () => setEditMode(true));
            cancelEditBtn.addEventListener('click', () => setEditMode(false));
            newUsernameInput.addEventListener('input', updateCounterAndValidation);


            applyUsernameBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                const newUsername = newUsernameInput.value.trim();
                
                if (applyUsernameBtn.disabled || changesRemaining <= 0) {
                    showMessage(messageElement, 'Cannot apply changes due to validation errors, rate limit, or no change was made.', 'error');
                    return;
                }

                applyUsernameBtn.disabled = true;
                showMessage(messageElement, '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Checking availability and profanity...', 'warning');

                try {
                    // --- Validation ---
                    if (newUsername.length < MIN_LENGTH || newUsername.length > MAX_LENGTH) { 
                        showMessage(messageElement, `Username must be between ${MIN_LENGTH} and ${MAX_LENGTH} characters.`, 'error'); 
                        return; 
                    }
                    if (!/^[a-zA-Z0-9.,\-+_\!\?\$\\]+$/.test(newUsername)) { 
                        showMessage(messageElement, 'Username contains invalid characters (Allowed symbols: .,-+\\_!?$).', 'error'); 
                        return; 
                    }
                    
                    // --- Checks ---
                    if (await checkProfanity(newUsername)) { 
                        showMessage(messageElement, 'This username is not allowed (Profanity filter triggered).', 'error'); 
                        return; 
                    }
                    if (await isUsernameTaken(newUsername)) { 
                        showMessage(messageElement, 'This username is already taken.', 'error'); 
                        return; 
                    }
                    
                    // --- Update Logic ---
                    const newChangesCount = changesThisMonth + 1;
                    await updateDoc(userDocRef, {
                        username: newUsername,
                        usernameChangesThisMonth: newChangesCount,
                        lastUsernameChangeMonth: currentMonthNumber 
                    });

                    showMessage(messageElement, `Username successfully changed to ${newUsername}!`, 'success');
                    
                    // Re-render the tab content to update the display, counter, and state
                    setTimeout(() => { switchTab('general'); }, 1500);

                } catch (error) {
                    console.error("Error updating username:", error);
                    showMessage(messageElement, `An unexpected error occurred: ${error.message}`, 'error');
                } finally {
                    if (messageElement.innerHTML.includes('Error') || messageElement.innerHTML.includes('not allowed') || messageElement.innerHTML.includes('taken')) {
                        applyUsernameBtn.disabled = false;
                    }
                }
            });
            
            
            // =================================================================
            // --- PASSWORD CHANGE LOGIC (Conditional) ---
            // =================================================================
            if (isEmailPasswordUser) {
                const currentPasswordInput = document.getElementById('currentPasswordInput');
                const newPasswordInput = document.getElementById('newPasswordInput');
                const confirmPasswordInput = document.getElementById('confirmPasswordInput');
                const applyPasswordBtn = document.getElementById('applyPasswordBtn');
                const passwordMessage = document.getElementById('passwordMessage');
                
                // Input handler for enabling/disabling apply button
                const checkPasswordFields = () => {
                    const currentPass = currentPasswordInput.value;
                    const newPass = newPasswordInput.value;
                    const confirmPass = confirmPasswordInput.value;
                    
                    const MIN_PASS_LENGTH = 6;
                    
                    const isLengthValid = newPass.length >= MIN_PASS_LENGTH;
                    const isMatch = newPass === confirmPass;
                    const isCurrentProvided = currentPass.length > 0;
                    
                    // Enable if all requirements are met
                    applyPasswordBtn.disabled = !(isLengthValid && isMatch && isCurrentProvided);
                    
                    // Provide gentle feedback
                    showMessage(passwordMessage, '', 'success');
                    if (newPass.length > 0 && newPass.length < MIN_PASS_LENGTH) {
                        showMessage(passwordMessage, `New password must be at least ${MIN_PASS_LENGTH} characters.`, 'warning');
                    } else if (newPass.length >= MIN_PASS_LENGTH && confirmPass.length > 0 && newPass !== confirmPass) {
                         showMessage(passwordMessage, 'New and confirmation passwords do not match.', 'warning');
                    } else if (newPass === currentPass && isLengthValid && isMatch) {
                         showMessage(passwordMessage, 'New password cannot be the same as your current password.', 'warning');
                         applyPasswordBtn.disabled = true;
                    }
                };

                currentPasswordInput.addEventListener('input', checkPasswordFields);
                newPasswordInput.addEventListener('input', checkPasswordFields);
                confirmPasswordInput.addEventListener('input', checkPasswordFields);
                
                applyPasswordBtn.addEventListener('click', async () => {
                    applyPasswordBtn.disabled = true;
                    showMessage(passwordMessage, '', 'success'); // Clear prior message
                    showMessage(passwordMessage, '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Attempting password change...', 'warning');

                    const currentPass = currentPasswordInput.value;
                    const newPass = newPasswordInput.value;
                    
                    if (newPass.length < 6) {
                         showMessage(passwordMessage, 'New password must be at least 6 characters.', 'error');
                         applyPasswordBtn.disabled = false;
                         return;
                    }
                    if (newPass === currentPass) {
                        showMessage(passwordMessage, 'New password cannot be the same as your current password.', 'error');
                        applyPasswordBtn.disabled = false;
                        return;
                    }

                    try {
                        // 1. Re-authenticate the user
                        const credential = EmailAuthProvider.credential(currentUser.email, currentPass);
                        await reauthenticateWithCredential(currentUser, credential);

                        // 2. Update the password
                        await updatePassword(currentUser, newPass);

                        showMessage(passwordMessage, 'Password successfully updated!', 'success');
                        
                        // Clear fields on success
                        currentPasswordInput.value = '';
                        newPasswordInput.value = '';
                        confirmPasswordInput.value = '';
                        // Re-check fields to disable the button
                        checkPasswordFields(); 

                    } catch (error) {
                        console.error("Error changing password:", error);
                        let errorMessage = "An unknown error occurred.";
                        
                        switch (error.code) {
                            case 'auth/requires-recent-login':
                                errorMessage = 'Password change failed. Please sign out and sign in again to change your password.';
                                break;
                            case 'auth/wrong-password':
                                errorMessage = 'The current password you provided is incorrect.';
                                break;
                            case 'auth/weak-password':
                                errorMessage = 'The new password is too weak. Please use a stronger one (min 6 characters).';
                                break;
                            default:
                                errorMessage = `Password change failed. (${error.message})`;
                        }
                        showMessage(passwordMessage, errorMessage, 'error');
                    } finally {
                        // Re-enable button if there was an error
                        if (!passwordMessage.innerHTML.includes('success')) {
                            applyPasswordBtn.disabled = false;
                        }
                    }
                });
            }
            
        }
        

        
        
        /**
         * NEW: Loads data and adds event listeners for the Personalization tab.
         */
        async function loadPersonalizationTab() {
            const themePickerContainer = document.getElementById('theme-picker-container');
            const themeMessage = document.getElementById('themeMessage');
            const pfpMessage = document.getElementById('pfpMessage'); 
            
            // --- 1. PROFILE PICTURE LOGIC ---
            if (currentUser) {
                const userDocRef = getUserDocRef(currentUser.uid);
                let userData = {};
                try {
                    const snap = await getDoc(userDocRef);
                    if (snap.exists()) {
                        userData = snap.data();
                        // Initialize mibiAvatarState with saved config if available
                        if (userData.mibiConfig) {
                            mibiAvatarState = { ...mibiAvatarState, ...userData.mibiConfig };
                        }
                    }
                } catch (e) { console.error("Error fetching PFP settings:", e); }

                const currentPfpType = userData.pfpType || 'google';
                const pfpModeSelect = document.getElementById('pfpModeSelect');
                const mibiSettings = document.getElementById('pfpMibiSettings'); // Renamed
                const letterSettings = document.getElementById('pfpLetterSettings'); // NEW
                const customSettings = document.getElementById('pfpCustomSettings');
                const previewImg = document.getElementById('customPfpPreview');
                const previewPlaceholder = document.getElementById('customPfpPlaceholder');
                const macMenu = document.getElementById('mibi-mac-menu'); // Reference to the MAC menu overlay
                const openMacMenuBtn = document.getElementById('open-mac-menu-btn'); // New button

                // --- CONDITIONAL GOOGLE OPTION ---
                const hasGoogle = currentUser.providerData.some(p => p.providerId === 'google.com');
                if (!hasGoogle) {
                    const googleOption = Array.from(pfpModeSelect.options).find(opt => opt.value === 'google');
                    if (googleOption) {
                        googleOption.remove();
                    }
                    if (currentPfpType === 'google') {
                        // Just let the UI default to the first available option or handle visually.
                    }
                }

                // Function to dispatch instant update event
                const triggerNavbarUpdate = () => {
                    window.dispatchEvent(new CustomEvent('pfp-updated', { 
                        detail: { 
                            pfpType: userData.pfpType, 
                            customPfp: userData.customPfp,
                            letterAvatarText: userData.letterAvatarText,
                            letterAvatarColor: userData.letterAvatarColor
                        }
                    }));
                };

                // Function to update UI visibility and the avatar preview
                const updatePfpUi = (type) => {
                    mibiSettings.classList.toggle('hidden', type !== 'mibi');
                    letterSettings.classList.toggle('hidden', type !== 'letter'); // NEW
                    customSettings.classList.toggle('hidden', type !== 'custom');
                    // Hide the MAC menu overlay unless explicitly opened
                    macMenu.classList.add('hidden');

                    // Update avatar preview based on type
                    if (type === 'custom' && userData.customPfp) {
                        customPfpPreview.src = userData.customPfp;
                        customPfpPreview.style.display = 'block';
                        customPfpPlaceholder.style.display = 'none';
                    } else {
                        // Default/Google or no custom/mibi set
                        customPfpPreview.style.display = 'none';
                        customPfpPlaceholder.style.display = 'flex';
                        customPfpPlaceholder.className = `w-full h-full flex items-center justify-center text-gray-600`;
                        customPfpPlaceholder.innerHTML = '<i class="fa-solid fa-user"></i>'; // Reset to default icon
                        customPfpPlaceholder.style.background = ''; // Clear custom background
                        customPfpPlaceholder.style.color = ''; // Clear custom color
                    }
                };

                // Init Custom Dropdown
                const pfpDropdown = setupCustomDropdown(pfpModeSelect, async (type) => {
                    updatePfpUi(type);
                    // Auto-save type change
                    try {
                        await updateDoc(userDocRef, { pfpType: type });
                        userData.pfpType = type; // Update local state
                        triggerNavbarUpdate();
                        showMessage(pfpMessage, 'Preference saved!', 'success');
                    } catch (e) {
                        showMessage(pfpMessage, 'Error saving preference.', 'error');
                    }
                });

                if (!pfpDropdown) { // Defensive check
                    console.error("pfpDropdown could not be initialized.");
                    return; // Exit if dropdown failed to initialize
                }
                
                // --- LETTER AVATAR LOGIC ---
                const letterCanvas = document.getElementById('letterCanvas');
                const letterCtx = letterCanvas ? letterCanvas.getContext('2d') : null;
                const colorPicker = document.getElementById('colorPicker');
                const letterPicker = document.getElementById('letterPicker');
                const saveLetterBtn = document.getElementById('saveLetterPfpBtn');

                const letterColors = [
                    'AA47BC', '7A1FA2', '78909C', '465A65', 'EC407A', 'C2175B', '5C6BC0', '0288D1',
                    '00579C', '0098A6', '00887A', '004C3F', '689F39', '33691E', '8C6E63', '5D4038',
                    '7E57C2', '512DA7', 'EF6C00', 'F5511E', 'BF360C'
                ];
                const letterChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890';

                let selectedColor = userData.letterAvatarColor ? userData.letterAvatarColor.replace('#', '') : '00579C';
                // Default letter: User's first initial or 'A'
                let userInitial = 'A';
                if (userData.username) userInitial = userData.username.charAt(0).toUpperCase();
                else if (currentUser.displayName) userInitial = currentUser.displayName.charAt(0).toUpperCase();
                else if (currentUser.email) userInitial = currentUser.email.charAt(0).toUpperCase();

                let selectedLetter = userData.letterAvatarText || userInitial;
                
                function drawLetter(letter, color) {
                    if (!letterCtx) return;
                    letterCtx.clearRect(0, 0, letterCanvas.width, letterCanvas.height);
                    
                    letterCtx.fillStyle = color;
                    letterCtx.fillRect(0, 0, letterCanvas.width, letterCanvas.height);
                    letterCtx.fillStyle = 'white';
                    letterCtx.font = '110px Yantramanav, sans-serif'; 
                    letterCtx.textAlign = 'center';
                    letterCtx.textBaseline = 'middle';
                    
                    // Center text adjustment
                    letterCtx.fillText(letter, letterCanvas.width / 2, letterCanvas.height / 2 + 10); 
                }

                function initLetterUi() {
                    if (!colorPicker || !letterPicker) return;
                    colorPicker.innerHTML = '';
                    letterPicker.innerHTML = '';

                    // Color Picker
                    letterColors.forEach(color => {
                        const sq = document.createElement('div');
                        sq.className = `colorSquare ${selectedColor === color ? 'selected' : ''}`;
                        sq.style.backgroundColor = `#${color}`;
                        sq.onclick = () => {
                            selectedColor = color;
                            drawLetter(selectedLetter, `#${selectedColor}`);
                            updateSelection(colorPicker, sq);
                        };
                        colorPicker.appendChild(sq);
                    });

                    // Letter Picker
                    for (const char of letterChars) {
                        const sq = document.createElement('div');
                        sq.className = `letterSquare ${selectedLetter === char ? 'selected' : ''}`;
                        sq.textContent = char;
                        sq.onclick = () => {
                            selectedLetter = char;
                            drawLetter(selectedLetter, `#${selectedColor}`);
                            updateSelection(letterPicker, sq);
                        };
                        letterPicker.appendChild(sq);
                    }
                    
                    drawLetter(selectedLetter, `#${selectedColor}`);
                    
                    // Ensure font loads
                    document.fonts.load('110px Yantramanav').then(() => drawLetter(selectedLetter, `#${selectedColor}`));
                }

                function updateSelection(container, selectedEl) {
                    Array.from(container.children).forEach(c => c.classList.remove('selected'));
                    selectedEl.classList.add('selected');
                }
                
                // Initialize Letter UI
                initLetterUi();

                if (saveLetterBtn) {
                    saveLetterBtn.addEventListener('click', async () => {
                        showMessage(pfpMessage, '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Saving Letter Avatar...', 'warning');
                        try {
                            const hexColor = `#${selectedColor}`;
                            await updateDoc(userDocRef, {
                                pfpType: 'letter',
                                letterAvatarText: selectedLetter,
                                letterAvatarColor: hexColor,
                                pfpLetterBg: hexColor // For compatibility
                            });
                            
                            userData.pfpType = 'letter';
                            userData.letterAvatarText = selectedLetter;
                            userData.letterAvatarColor = hexColor;
                            
                            triggerNavbarUpdate();
                            showMessage(pfpMessage, 'Letter Avatar saved successfully!', 'success');
                            
                            // Update dropdown state without re-triggering everything
                            pfpDropdown.setValue('letter'); 
                            updatePfpUi('letter');

                        } catch (e) {
                            console.error("Error saving letter avatar:", e);
                            showMessage(pfpMessage, 'Failed to save avatar.', 'error');
                        }
                    });
                }
                
                // Add event listener for the Open Mibi Avatar Creator button
                if (openMacMenuBtn) {
                    openMacMenuBtn.addEventListener('click', () => {
                        macMenu.classList.remove('hidden'); // Show the MAC menu overlay
                        currentMacSlide = 1; // Reset to first slide
                        showMacSlide(currentMacSlide);
                    });
                }

                // Set initial display based on saved settings
                pfpDropdown.setValue(currentPfpType);
                if (currentPfpType === 'custom') {
                    customSettings.classList.remove('hidden');
                } else if (currentPfpType === 'mibi') {
                    mibiSettings.classList.remove('hidden'); // Ensure the container div for Mibi settings is visible
                } else if (currentPfpType === 'letter') {
                    letterSettings.classList.remove('hidden');
                }
                const uploadBtn = document.getElementById('uploadPfpBtn');
                const fileInput = document.getElementById('pfpFileInput');
                const cropperModal = document.getElementById('cropperModal');
                const cropperCanvas = document.getElementById('cropperCanvas');
                const cancelCropBtn = document.getElementById('cancelCropBtn');
                const submitCropBtn = document.getElementById('submitCropBtn');
                
                // Show existing custom pfp in preview
                if (userData.customPfp) {
                    previewImg.src = userData.customPfp;
                    previewImg.style.display = 'block';
                    previewPlaceholder.style.display = 'none';
                }

                uploadBtn.addEventListener('click', () => fileInput.click());

                let cropperImage = null;
                let cropState = { x: 0, y: 0, radius: 100 };
                let isDragging = false;
                let dragStart = { x: 0, y: 0 };
                const ctx = cropperCanvas.getContext('2d');

                fileInput.addEventListener('change', (e) => {
                    const file = e.target.files[0];
                    if (!file) return;
                    
                    if (file.size > 2 * 1024 * 1024) {
                        showMessage(pfpMessage, 'File is too large (max 2MB).', 'error');
                        return;
                    }

                    const reader = new FileReader();
                    reader.onload = (evt) => {
                        cropperImage = new Image();
                        cropperImage.onload = () => {
                            // Setup canvas with fixed height for consistency
                            const fixedHeight = 400;
                            const scale = fixedHeight / cropperImage.height;
                            cropperCanvas.height = fixedHeight;
                            cropperCanvas.width = cropperImage.width * scale;
                            
                            // Initial crop state: center, 1/3 min dim
                            cropState = {
                                x: cropperCanvas.width / 2,
                                y: cropperCanvas.height / 2,
                                radius: Math.min(cropperCanvas.width, cropperCanvas.height) / 3
                            };
                            
                            cropperModal.style.display = 'flex';
                            requestAnimationFrame(drawCropper);
                        };
                        cropperImage.src = evt.target.result;
                    };
                    reader.readAsDataURL(file);
                });
                
                const drawCropper = () => {
                    if (!cropperImage) return;
                    const w = cropperCanvas.width;
                    const h = cropperCanvas.height;
                    ctx.clearRect(0, 0, w, h);
                    
                    // Draw image filling canvas
                    ctx.drawImage(cropperImage, 0, 0, w, h);
                    
                    // Draw overlay
                    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
                    ctx.beginPath();
                    ctx.rect(0, 0, w, h);
                    // Cut hole
                    ctx.arc(cropState.x, cropState.y, cropState.radius, 0, 2 * Math.PI, true);
                    ctx.fill();
                    
                    // Draw dashed border
                    ctx.strokeStyle = '#fff';
                    ctx.lineWidth = 2;
                    ctx.setLineDash([6, 4]); // Dashed pattern
                    ctx.beginPath();
                    ctx.arc(cropState.x, cropState.y, cropState.radius, 0, 2 * Math.PI);
                    ctx.stroke();
                    ctx.setLineDash([]); // Reset
                };

                // Interaction Handlers
                const handleStart = (x, y) => {
                    const dx = x - cropState.x;
                    const dy = y - cropState.y;
                    if (dx*dx + dy*dy < cropState.radius * cropState.radius) {
                        isDragging = true;
                        dragStart = { x, y };
                    }
                };
                
                const handleMove = (x, y) => {
                    if (isDragging) {
                        const dx = x - dragStart.x;
                        const dy = y - dragStart.y;
                        
                        let newX = cropState.x + dx;
                        let newY = cropState.y + dy;
                        
                        // Constraint: Circle must stay within canvas
                        // x - radius >= 0  => x >= radius
                        // x + radius <= w  => x <= w - radius
                        const r = cropState.radius;
                        const w = cropperCanvas.width;
                        const h = cropperCanvas.height;
                        
                        newX = Math.max(r, Math.min(newX, w - r));
                        newY = Math.max(r, Math.min(newY, h - r));
                        
                        cropState.x = newX;
                        cropState.y = newY;
                        
                        dragStart = { x, y };
                        requestAnimationFrame(drawCropper);
                    }
                };

                const handleEnd = () => { isDragging = false; };
                
                const handleScroll = (e) => {
                    e.preventDefault();
                    const delta = e.deltaY > 0 ? -5 : 5;
                    let newRadius = cropState.radius + delta;
                    
                    const w = cropperCanvas.width;
                    const h = cropperCanvas.height;
                    
                    // 1. Absolute Max Radius constraint (half of smallest dimension)
                    const maxPossibleRadius = Math.min(w, h) / 2;
                    
                    // Clamp requested radius to valid range [20, maxPossibleRadius]
                    newRadius = Math.max(20, Math.min(newRadius, maxPossibleRadius));
                    
                    // 2. Calculate required bounds for center (x, y) given newRadius
                    // The center must be at least newRadius away from any edge.
                    const minX = newRadius;
                    const maxX = w - newRadius;
                    const minY = newRadius;
                    const maxY = h - newRadius;
                    
                    // 3. Clamp current center to these new valid bounds
                    // This effectively "pushes" the circle inwards if it was too close to the edge for the new size
                    cropState.x = Math.max(minX, Math.min(cropState.x, maxX));
                    cropState.y = Math.max(minY, Math.min(cropState.y, maxY));
                    
                    cropState.radius = newRadius;
                    requestAnimationFrame(drawCropper);
                };

                cropperCanvas.addEventListener('mousedown', e => handleStart(e.offsetX, e.offsetY));
                cropperCanvas.addEventListener('mousemove', e => handleMove(e.offsetX, e.offsetY));
                cropperCanvas.addEventListener('mouseup', handleEnd);
                cropperCanvas.addEventListener('mouseleave', handleEnd);
                cropperCanvas.addEventListener('wheel', handleScroll);
                
                // Touch support
                cropperCanvas.addEventListener('touchstart', e => {
                    e.preventDefault();
                    const rect = cropperCanvas.getBoundingClientRect();
                    const touch = e.touches[0];
                    // Account for CSS scaling if canvas is displayed smaller than actual size
                    // offsetX = (clientX - left) * (canvas.width / clientWidth)
                    const scaleX = cropperCanvas.width / rect.width;
                    const scaleY = cropperCanvas.height / rect.height;
                    handleStart((touch.clientX - rect.left) * scaleX, (touch.clientY - rect.top) * scaleY);
                });
                cropperCanvas.addEventListener('touchmove', e => {
                    e.preventDefault();
                    const rect = cropperCanvas.getBoundingClientRect();
                    const touch = e.touches[0];
                    const scaleX = cropperCanvas.width / rect.width;
                    const scaleY = cropperCanvas.height / rect.height;
                    handleMove((touch.clientX - rect.left) * scaleX, (touch.clientY - rect.top) * scaleY);
                });
                cropperCanvas.addEventListener('touchend', handleEnd);

                cancelCropBtn.addEventListener('click', () => {
                    cropperModal.style.display = 'none';
                    fileInput.value = ''; // Reset
                });

                submitCropBtn.addEventListener('click', async () => {
                    // Create final cropped image
                    const tempCanvas = document.createElement('canvas');
                    const size = 128; // Output size
                    tempCanvas.width = size;
                    tempCanvas.height = size;
                    const tCtx = tempCanvas.getContext('2d');
                    
                    // Mapping back to original image
                    // Canvas was scaled to fixedHeight (400).
                    // scale = 400 / image.height
                    // originalX = cropState.x / scale
                    const scale = cropperCanvas.height / cropperImage.height;
                    
                    const sourceX = (cropState.x - cropState.radius) / scale;
                    const sourceY = (cropState.y - cropState.radius) / scale;
                    const sourceSize = (cropState.radius * 2) / scale;
                    
                    tCtx.drawImage(cropperImage, sourceX, sourceY, sourceSize, sourceSize, 0, 0, size, size);
                    
                    const base64 = tempCanvas.toDataURL('image/jpeg', 0.8);
                    
                    // Save to Firestore
                    try {
                        submitCropBtn.disabled = true;
                        submitCropBtn.textContent = "Saving...";
                        await updateDoc(userDocRef, { 
                            customPfp: base64,
                            pfpType: 'custom'
                        });
                        
                        userData.customPfp = base64;
                        userData.pfpType = 'custom';
                        triggerNavbarUpdate();
                        
                        // Update UI
                        pfpDropdown.setValue('custom'); // Use custom dropdown method
                        updatePfpUi('custom');
                        previewImg.src = base64;
                        previewImg.style.display = 'block';
                        previewPlaceholder.style.display = 'none';
                        
                        cropperModal.style.display = 'none';
                        showMessage(pfpMessage, 'Profile picture updated!', 'success');
                    } catch (e) {
                        console.error(e);
                        alert('Failed to save image.');
                    } finally {
                        submitCropBtn.disabled = false;
                        submitCropBtn.innerHTML = '<i class="fa-solid fa-check mr-2"></i> Submit';
                    }
                });
            }

            // Setup MAC Menu Listeners
            setupMacMenuListeners();

            // --- MAC Menu: Slide 2 (Background Color) Event Listeners ---
            const mibiColorPalette = document.getElementById('mibi-color-palette');
            const mibiCustomColorPicker = document.getElementById('mibi-custom-color-picker');

            if (mibiColorPalette) {
                mibiColorPalette.querySelectorAll('.color-swatch').forEach(swatch => {
                    swatch.addEventListener('click', () => {
                        const color = swatch.dataset.color;
                        if (color === 'custom') {
                            mibiCustomColorPicker.click(); // Open color picker
                        } else {
                            mibiAvatarState.bgColor = color;
                            updateMibiAvatarPreview();
                        }
                    });
                });
            }

            if (mibiCustomColorPicker) {
                mibiCustomColorPicker.addEventListener('input', (e) => {
                    mibiAvatarState.bgColor = e.target.value;
                    updateMibiAvatarPreview();
                });
            }

            // --- MAC Menu: Slide 3 (Orientation) Event Listeners ---
            const mibiSizeSlider = document.getElementById('mibi-size-slider');
            const mibiRotationSlider = document.getElementById('mibi-rotation-slider');

            if (mibiSizeSlider) {
                mibiSizeSlider.addEventListener('input', (e) => {
                    mibiAvatarState.size = parseInt(e.target.value, 10);
                    updateMibiAvatarPreview();
                });
            }

            if (mibiRotationSlider) {
                mibiRotationSlider.addEventListener('input', (e) => {
                    mibiAvatarState.rotation = parseInt(e.target.value, 10);
                    updateMibiAvatarPreview();
                });
            }

            // --- 2. THEME LOGIC (Existing) ---
            
            if (!themePickerContainer) return;
            
            // From navigation.js
            const lightThemeNames = ['Light', 'Lavender', 'Rose Gold', 'Mint', 'Pink'];

            try {
                // 1. Fetch themes
                const response = await fetch('../themes.json');
                if (!response.ok) throw new Error('Failed to fetch themes.json');
                let themes = await response.json(); // Use 'let' to reassign
                
                if (!themes || themes.length === 0) {
                     throw new Error('themes.json is empty or invalid');
                }

                // --- NEW: Sorting Logic ---
                const orderedThemeNames = ['Dark', 'Light', 'Christmas'];
                const sortedThemes = [];

                // Add themes in the specified order first
                orderedThemeNames.forEach(name => {
                    const theme = themes.find(t => t.name === name);
                    if (theme) {
                        sortedThemes.push(theme);
                        themes = themes.filter(t => t.name !== name); // Remove from original list
                    }
                });

                // Sort remaining themes by Rainbow Color then Type
                const colorMap = {
                    'Crimson': 1, 'Fire': 1,
                    'Orange': 2, 'Sunset': 2, 'Rust': 2, 'Ember': 2, 'Copper': 2,
                    'Gold': 3,
                    'Green': 4, 'Forest': 4, 'Matrix': 4,
                    'Mint': 5,
                    'Ocean': 6, 'Deep Blue': 6,
                    'Purple': 7, 'Royal': 7, 'Haze': 7, 'Lavender': 7,
                    'Pink': 8, 'Coral': 8, 'Rose Gold': 8,
                    'Clanker': 9, 'Monochrome': 9, 'Silver': 9, 'Slate': 9
                };
                
                // Helper to determine type (Dark=0, Light=1 for sorting)
                // Light themes use logo-dark.png
                const getThemeType = (t) => (t['logo-src'] && t['logo-src'].includes('logo-dark.png')) ? 1 : 0;

                themes.sort((a, b) => {
                    const colorA = colorMap[a.name] || 100; // Default to end if unknown
                    const colorB = colorMap[b.name] || 100;
                    
                    if (colorA !== colorB) {
                        return colorA - colorB;
                    }
                    
                    // If same color, sort by type
                    const typeA = getThemeType(a);
                    const typeB = getThemeType(b);
                    
                    if (typeA !== typeB) {
                        return typeA - typeB; // Dark first, then Light
                    }
                    
                    // If same color and type, alphabetical
                    return a.name.localeCompare(b.name);
                });

                // Combine them
                themes = [...sortedThemes, ...themes];
                // --- END NEW: Sorting Logic ---
                
                // 2. Get currently saved theme to set the active state
                let savedTheme = null;
                try {
                    savedTheme = JSON.parse(localStorage.getItem(THEME_STORAGE_KEY));
                } catch (e) {
                    console.warn('Could not parse saved theme.');
                }
                
                // 3. Process and render themes
                const modifiedThemes = []; // Store themes with correct logo paths
                let themeButtonsHtml = '';
                
                for (const theme of themes) {
                    // --- This is the logic requested by the user ---
                    // It modifies the theme object *in memory* before saving/applying
                    // We use root-relative paths as defined in navigation.js
                    if (lightThemeNames.includes(theme.name)) {
                        theme['logo-src'] = 'https://cdn.jsdelivr.net/npm/4sp-dv@latest/images/logo-dark.png'; 
                    } else {
                        theme['logo-src'] = 'https://cdn.jsdelivr.net/npm/4sp-dv@latest/images/logo.png';
                    }
                    // --- End of user logic ---
                    
                    modifiedThemes.push(theme);
                    
                    const isActive = savedTheme && savedTheme.name === theme.name;
                    
                    // === MODIFICATION START ===
                    // Get the theme's main background and text colors for the button
                    const previewBg = theme['navbar-bg'] || '#000000';
                    const previewText = theme['navbar-text'] || '#c0c0c0';
                    // Get the theme's accent border color
                    const previewBorder = theme['tab-active-border'] || '#4f46e5';


                    themeButtonsHtml += `
                        <button 
                            class="theme-button ${isActive ? 'active' : ''}" 
                            data-theme-name="${theme.name}" 
                            style="background-color: ${previewBg}; border-color: ${previewBorder};"
                        >
                            <div class="theme-button-name" style="color: ${previewText};">${theme.name}</div>
                        </button>
                    `;
                    // === MODIFICATION END ===
                }
                
                // Inject buttons into the DOM
                themePickerContainer.innerHTML = themeButtonsHtml;
                
                // 4. Add event listeners
                const themeButtons = themePickerContainer.querySelectorAll('.theme-button');
                themeButtons.forEach(button => {
                    button.addEventListener('click', async () => {
                        const themeName = button.dataset.themeName;
                        const themeToApply = modifiedThemes.find(t => t.name === themeName);
                        
                        if (themeToApply) {
                            // 1. Save to localStorage (Backup/Fast Load)
                            localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(themeToApply));
                            
                            // 2. Apply theme for live preview
                            if (window.applyTheme) {
                                window.applyTheme(themeToApply);
                            } else {
                                console.error('window.applyTheme is not defined. Is navigation.js loaded?');
                                showMessage(themeMessage, 'Error applying theme preview.', 'error');
                                return;
                            }

                            // 3. Save to Firestore (Persistence)
                            if (currentUser) {
                                try {
                                    const userDocRef = getUserDocRef(currentUser.uid);
                                    // Ensure we're only saving valid data
                                    await updateDoc(userDocRef, { navbarTheme: themeToApply });
                                } catch (error) {
                                    console.error("Error saving theme to Firestore:", error);
                                    // Don't block UI feedback for this
                                }
                            }
                            
                            // 4. Update active class
                            themeButtons.forEach(btn => btn.classList.remove('active'));
                            button.classList.add('active');
                            
                            // 5. Show success message
                            showMessage(themeMessage, `${themeToApply.name} theme applied!`, 'success');
                        }
                    });
                });

            } catch (error) {
                console.error('Error loading themes:', error);
                themePickerContainer.innerHTML = `<p class="text-red-400">Error: Could not load themes. (${error.message})</p>`;
            }
        }
        
        // --- NEW: Loads data and adds event listeners for the Data tab ---
        async function loadDataTab() {
            // Get elements (buttons, modal)
            const exportBtn = document.getElementById('exportDataBtn');
            const importBtn = document.getElementById('importDataBtn');
            const modal = document.getElementById('modalPrompt');
            const modalClose = document.getElementById('modalClose');
            
            // Wire up buttons
            if (exportBtn) exportBtn.addEventListener('click', downloadAllSaves);
            if (importBtn) importBtn.addEventListener('click', handleFileUpload);
            
            // Wire up modal close events
            if (modalClose) {
                modalClose.addEventListener('click', () => {
                    modal.style.display = "none";
                });
            }
            // Use a new listener specific to this page
            const modalBackground = document.getElementById('modalPrompt');
            if (modalBackground) {
                modalBackground.addEventListener('click', event => {
                    if (event.target === modalBackground) {
                        modal.style.display = "none";
                    }
                });
            }
        }


        /**
         * Handles the switching of tabs and updating the main content view.
         */
        async function switchTab(tabId) {
            // 1. Update active class on sidebar tabs
            sidebarTabs.forEach(tab => {
                tab.classList.remove('active');
            });
            document.getElementById(`tab-${tabId}`).classList.add('active');

            // 2. Update the main view content and alignment
            mainView.style.justifyContent = 'flex-start';
            mainView.style.alignItems = 'flex-start';

            if (tabId === 'general') {
                await loadGeneralTab(); 
            }
            else if (tabId === 'personalization') {
                // --- NEW: Load Personalization Tab ---
                mainView.innerHTML = getPersonalizationContent(); // Render HTML
                await loadPersonalizationTab(); // Load data and add listeners
            }
            else if (tabId === 'about') {
                mainView.innerHTML = getAboutContent();
            } else {
                const content = tabContent[tabId];
                if (content) {
                    mainView.innerHTML = getComingSoonContent(content.title);
                }
            }

            // 3. New: Smoothly scroll the window back to the top (y=0)
            window.scrollTo({
                top: 0,
                behavior: 'smooth'
            });
        }

        // --- Initialization on Load ---
        
        // Add listener to each sidebar button
        sidebarTabs.forEach(tab => {
            tab.addEventListener('click', async () => {
                await switchTab(tab.dataset.tab);
            });
        });


        // --- AUTHENTICATION/REDIRECT LOGIC (Retained and Modified) ---



        function initializeAuth() {
            onAuthStateChanged(auth, async (user) => {
                if (user || window._LOCAL_MODE) {
                    currentUser = user || { uid: 'client-user', email: 'client@4sp' }; 
                    
                    // --- MODIFIED: Mandatory Admin Status Check ---
                    // We MUST await this check before proceeding to load tabs that might require admin privileges.
                    // This prevents "Missing or insufficient permissions" errors due to race conditions.
                    isUserAdmin = user ? await checkAdminStatus(user.uid) : false;

                    if (isUserAdmin) {
                        const adminTab = document.getElementById('tab-management');
                        if (adminTab) adminTab.classList.remove('hidden');
                    }

                    // Set initial state to 'General' (or the first tab)
                    switchTab('general'); 
                } else {
                    // No user is logged in, redirect to authentication.html (path corrected)
                    window.location.href = '../authentication.html'; 
                }
            });
        }
        
        // Use a short timeout to allow the rest of the script to run before auth check
        setTimeout(() => { initializeAuth(); }, 100);
