/* WepChat - 应用设置与远程配置 */
'use strict';

(() => {
  const { nextTick, clone, cleanTitle, normalizeSession, newProvider, parseModels, modelsText, imageModelsText, providerModelMeta, tokenMessageText, imageExtForMime, imageFileName, attachmentFileName, fileSafeName, normalizeWorkspacePath, parentFolder, ensureParentFolders, workspaceMime, workspaceExt, isHtmlName, isMarkdownName, isImageName, isJsName, RELEASES_URL, LATEST_RELEASE_API, normalizeAppVersion, appTag, parseReleaseTag, compareReleaseTags, formatReleaseDate, fetchLatestRelease, plusRuntimeVersion, manifestVersion, normalizeStylePreset, isEditableName, languageForName, resolveWorkspaceRef, dataUrlDownload, readPickedFile, escapeScriptEnd, isExternalRef, externalWebUrl, normalizeRef, htmlAttr, TextTargets, TextTimers, TextResolvers, resolveTyping, smoothText, waitSmoothText, streamToolKey, findToolDisplay, syncStreamToolCalls, clearStreamState, finalizeStreamToolCalls, discardStreamToolCalls, cancelStreamToolCalls } = window.WepChatAppHelpers;
  window.WepChatAppMethodsCore = {
      initPlusApp() {
        if (this.plusReady || !window.plus) return;
        this.plusReady = true;
        document.documentElement.classList.add('plus-app');
        this.applyTheme();
        this.refreshAppVersion({ force: true });
        this.initPushHandlers();
        if (plus.key && !this.backHandler) {
          this.backHandler = () => this.handleBackButton();
          plus.key.addEventListener('backbutton', this.backHandler, false);
        }
      },
      async handleBackButton() {
        if (this.appLocked) {
          U.toast('请先解锁 WepChat');
          return;
        }
        if (this.onboardingOpen) {
          const now = Date.now();
          if (now - this.lastBackAt < 1800) {
            this.finishOnboarding();
            return;
          }
          this.lastBackAt = now;
          U.toast('再次返回退出引导');
          return;
        }
        if (this.dlg) {
          this.lastBackAt = 0;
          this.dlgAnswer(null);
          return;
        }
        if (this.sheet) {
          this.lastBackAt = 0;
          this.sheet = '';
          return;
        }
        if (this.drawerOpen) {
          this.lastBackAt = 0;
          this.drawerOpen = false;
          this.globalSearchOpen = false;
          return;
        }
        if (this.pages.length) {
          this.lastBackAt = 0;
          this.closePage();
          return;
        }
        const now = Date.now();
        if (now - this.lastBackAt < 1800) {
          await this.flushSessionPersist(900);
          if (window.plus && plus.runtime && plus.runtime.quit) plus.runtime.quit();
          return;
        }
        this.lastBackAt = now;
        U.toast('再次返回退出应用');
      },
      normalizeImageSettings() {
        const presets = this.imageStylePresets;
        this.settings.imageStylePresets = presets;
        if (this.settings.imageStylePresetId && !presets.some(p => p.id === this.settings.imageStylePresetId)) {
          this.settings.imageStylePresetId = '';
        }
        if (!this.imageSizeOptions.includes(this.settings.imageDefaultSize)) this.settings.imageDefaultSize = 'auto';
        if (!this.imageQualityOptions.some(x => x.value === this.settings.imageQuality)) this.settings.imageQuality = 'auto';
        if (!this.imageFormatOptions.some(x => x.value === this.settings.imageOutputFormat)) this.settings.imageOutputFormat = 'png';
        if (!this.imageBackgroundOptions.some(x => x.value === this.settings.imageBackground)) this.settings.imageBackground = 'auto';
      },
      persistSettings() {
        this.normalizeImageSettings();
        Store.saveSettings(this.settings);
        this.storageUsed = Store.usage();
        this.applyTheme();
      },
      refreshAppVersion(opts) {
        opts = opts || {};
        if (this.appVersionLoading && this._appVersionPromise) return this._appVersionPromise;
        if (this.appVersionLoaded && !opts.force) return Promise.resolve(this.appVersion);
        this.appVersionLoading = true;
        this._appVersionPromise = (async () => {
          const plusVersion = await plusRuntimeVersion();
          let version = plusVersion;
          let source = plusVersion ? 'app' : '';
          if (!version) {
            version = await manifestVersion();
            source = version ? 'manifest' : '';
          }
          if (version) {
            this.appVersion = version;
            this.appTag = appTag(version);
            this.appVersionSource = source;
          }
          this.appVersionLoaded = true;
          return this.appVersion;
        })().finally(() => {
          this.appVersionLoading = false;
          this._appVersionPromise = null;
        });
        return this._appVersionPromise;
      },
      setUpdateAutoCheck(on) {
        this.settings.updateAutoCheck = !!on;
        this.persistSettings();
      },
      async checkReleaseUpdate(opts) {
        opts = opts || {};
        if (this.updateCheck.checking) return;
        this.updateCheck.checking = true;
        this.updateCheck.failed = false;
        try {
          await this.refreshAppVersion();
          if (!this.appTag) throw new Error('version unavailable');
          const release = await fetchLatestRelease();
          const tag = String(release.tag_name || '').trim();
          const latest = {
            tag,
            name: String(release.name || tag || 'GitHub Release'),
            body: String(release.body || ''),
            url: String(release.html_url || RELEASES_URL),
            publishedAt: release.published_at || release.created_at || ''
          };
          const hasUpdate = compareReleaseTags(tag, this.appTag) > 0;
          this.updateCheck.latest = latest;
          this.updateCheck.hasUpdate = hasUpdate;
          this.updateCheck.checked = true;
          this.updateCheck.lastCheckedAt = Date.now();
          this.updateCheck.failed = false;
          if (!opts.silent && hasUpdate) U.toast('发现新版本 ' + tag);
        } catch (e) {
          this.updateCheck.failed = true;
          if (!opts.silent) this.updateCheck.checked = true;
        } finally {
          this.updateCheck.checking = false;
        }
      },
      openReleasePage(url) {
        U.openExternal(url || (this.latestRelease && this.latestRelease.url) || RELEASES_URL);
      },
      releaseDateText(value) {
        return formatReleaseDate(value);
      },
      persistProviders() {
        this.providers = this.providers.map(p => MODEL_META.normalizeProvider(p));
        Store.saveProviders(this.providers);
        this.storageUsed = Store.usage();
      },
      persistSession() {
        if (this.captureCurrentDraft) this.captureCurrentDraft();
        this.session = normalizeSession(this.session);
        Store.saveSession(this.session);
        this.upsertIndex(this.session);
        this.storageUsed = Store.usage();
      },
      persistSessionSoon() {
        if (this.persistTimer) return;
        const now = Date.now();
        const wait = Math.max(0, 900 - (now - (this.lastStreamPersistAt || 0)));
        this.persistTimer = setTimeout(() => {
          this.persistTimer = null;
          this.lastStreamPersistAt = Date.now();
          this.persistSession();
        }, wait);
      },
      async flushSessionPersist(timeoutMs) {
        const timeout = typeof timeoutMs === 'number' ? timeoutMs : 1200;
        if (this.persistTimer) {
          clearTimeout(this.persistTimer);
          this.persistTimer = null;
        }
        if (this.session && this.session.id) this.persistSession();
        if (Store.flush) await Store.flush(timeout);
      },
      handleVisibilityPersist() {
        if (document.visibilityState === 'hidden') {
          if (this.noteAppBackgroundForLock) this.noteAppBackgroundForLock();
          this.flushSessionPersist(1200);
          this.showRunningNotification();
        } else {
          if (this.lockAppIfNeeded) this.lockAppIfNeeded();
          this.clearRunningNotification();
        }
      },
      handleAppPause() {
        if (this.noteAppBackgroundForLock) this.noteAppBackgroundForLock();
        this.flushSessionPersist(1200);
        this.showRunningNotification();
      },
      handleAppResume() {
        if (this.lockAppIfNeeded) this.lockAppIfNeeded();
        this.clearRunningNotification();
      },
      initPushHandlers() {
        if (!window.plus || !plus.push || this.pushHandlerReady) return;
        this.pushHandlerReady = true;
        try {
          plus.push.addEventListener('click', () => {
            this.clearRunningNotification();
          }, false);
        } catch (e) {}
      },
      requestNotificationPermission() {
        if (this.notificationPermissionAsked || !window.plus || !plus.android || !plus.android.requestPermissions) return;
        const version = parseInt(plus.os && plus.os.version || '0', 10) || 0;
        if (version < 13) return;
        this.notificationPermissionAsked = true;
        try {
          plus.android.requestPermissions(['android.permission.POST_NOTIFICATIONS'], () => {}, () => {});
        } catch (e) {}
      },
      showRunningNotification() {
        if (!this.generating || this.runningNotifyShown || !window.plus || !plus.push || !plus.push.createMessage) return;
        try {
          plus.push.createMessage('正在生成回复，回到 WepChat 查看进度。', {
            type: 'generation',
            sessionId: this.session && this.session.id || ''
          }, {
            title: 'WepChat 正在运行',
            cover: false
          });
          this.runningNotifyShown = true;
        } catch (e) {}
      },
      clearRunningNotification() {
        if (!this.runningNotifyShown) return;
        try {
          if (window.plus && plus.push && plus.push.clear) plus.push.clear();
        } catch (e) {}
        this.runningNotifyShown = false;
      },
      upsertIndex(sess) {
        const meta = {
          id: sess.id,
          title: sess.title || '',
          createdAt: sess.createdAt,
          updatedAt: sess.updatedAt || U.now(),
          pinned: !!sess.pinned
        };
        const i = this.index.findIndex(x => x.id === sess.id);
        if (i >= 0) this.index[i] = Object.assign({}, this.index[i], meta);
        else this.index.unshift(meta);
        this.index.sort((a, b) => {
          if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
          return (b.updatedAt || 0) - (a.updatedAt || 0);
        });
        Store.saveIndex(this.index);
      },

      applyTheme() {
        const root = document.documentElement;
        const dark = this.settings.theme === 'dark' ||
          (this.settings.theme === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
        root.classList.toggle('dark', !!dark);
        root.classList.toggle('fs-large', this.settings.fontSize === 'large');
      },
      setTheme(v) {
        this.settings.theme = v;
        this.persistSettings();
      },
      setFontSize(v) {
        this.settings.fontSize = v;
        this.persistSettings();
      },
      setTemp(v) {
        const s = String(v || '').trim();
        this.settings.temperature = s === '' ? null : U.clamp(Number(s), 0, 2);
        this.persistSettings();
      },
      setMaxTokens(v) {
        const n = parseInt(v, 10);
        this.settings.maxTokens = Number.isFinite(n) && n > 0 ? n : null;
        this.persistSettings();
      },
      setAppMode(mode) {
        this.session.mode = mode === 'image' ? 'image' : 'chat';
        nextTick(() => this.growInput());
      },
      setImageCount(v) {
        const n = parseInt(v, 10);
        this.settings.imageDefaultCount = Number.isFinite(n) ? U.clamp(n, 1, 8) : 1;
        this.persistSettings();
      },
      imageStylePresetById(id) {
        id = String(id || '');
        return this.imageStylePresets.find(p => p.id === id) || null;
      },
      async addImageStylePreset() {
        const name = await this.askText('新增风格预设', '', '预设名称');
        if (name == null) return;
        const cleanName = U.truncate(String(name || '').replace(/\s+/g, ' ').trim(), 32);
        if (!cleanName) {
          U.toast('请填写预设名称');
          return;
        }
        const prompt = await this.askText('预设提示词', '', '用英文描述图片风格、光线、构图等', true);
        if (prompt == null) return;
        const preset = normalizeStylePreset({
          id: 'style_' + U.uuid().slice(0, 8),
          name: cleanName,
          prompt
        });
        if (!preset) {
          U.toast('请填写预设提示词');
          return;
        }
        this.settings.imageStylePresets = this.imageStylePresets.concat([preset]);
        this.settings.imageStylePresetId = preset.id;
        this.persistSettings();
      },
      async editImageStylePreset(preset) {
        preset = preset && this.imageStylePresetById(preset.id);
        if (!preset) return;
        const name = await this.askText('编辑风格名称', preset.name, '预设名称');
        if (name == null) return;
        const cleanName = U.truncate(String(name || '').replace(/\s+/g, ' ').trim(), 32);
        if (!cleanName) {
          U.toast('请填写预设名称');
          return;
        }
        const prompt = await this.askText('编辑预设提示词', preset.prompt, '用英文描述图片风格、光线、构图等', true);
        if (prompt == null) return;
        const nextPreset = normalizeStylePreset({ id: preset.id, name: cleanName, prompt });
        if (!nextPreset) {
          U.toast('请填写预设提示词');
          return;
        }
        this.settings.imageStylePresets = this.imageStylePresets.map(p => p.id === preset.id ? nextPreset : p);
        this.persistSettings();
      },
      async deleteImageStylePreset(preset) {
        preset = preset && this.imageStylePresetById(preset.id);
        if (!preset) return;
        const ok = await this.confirm('删除风格预设：' + preset.name, '删除预设');
        if (!ok) return;
        this.settings.imageStylePresets = this.imageStylePresets.filter(p => p.id !== preset.id);
        if (this.settings.imageStylePresetId === preset.id) this.settings.imageStylePresetId = '';
        this.persistSettings();
      },
      modelMeta(provider, id) {
        return providerModelMeta(provider, id);
      },
      modelCapText(provider, id) {
        return MODEL_META.capLabels(this.modelMeta(provider, id)).join(' · ');
      },
      modelContextText(provider, id) {
        const meta = this.modelMeta(provider, id);
        return MODEL_META.fmtTokens(meta.contextWindow || MODEL_META.DEFAULT_CONTEXT) + ' ctx';
      },
      modelSummary(provider, id) {
        const meta = this.modelMeta(provider, id);
        return this.modelContextText(provider, id) + ' · ' + MODEL_META.capLabels(meta).join(' · ');
      },
      setMaxToolRounds(v) {
        const n = parseInt(v, 10);
        this.settings.maxToolRounds = Number.isFinite(n) ? U.clamp(n, 1, 32) : 8;
        this.persistSettings();
      },
      setMaxToolCalls(v) {
        const n = parseInt(v, 10);
        this.settings.maxToolCalls = Number.isFinite(n) ? U.clamp(n, 1, 128) : 24;
        this.persistSettings();
      },
      fileKind(name, file) {
        if (file && file.dataUrl && !file.content) return 'image';
        if (isHtmlName(name)) return 'html';
        if (isMarkdownName(name)) return 'md';
        if (/\.(js|mjs|ts|css|json|vue|svg|py|sh|bat|kt|java|go|rs|php|rb|xml|ya?ml)$/i.test(name || '')) return 'code';
        return 'text';
      },
      fileExt(name) {
        return workspaceExt(name);
      },
      isFolderOpen(path) {
        return this.openFolders[path] !== false;
      },
      toggleFolder(path) {
        this.openFolders[path] = !this.isFolderOpen(path);
      },
      openWorkspaceRow(row) {
        if (this.workspaceLongPressFired) {
          this.workspaceLongPressFired = false;
          return;
        }
        if (!row) return;
        if (row.type === 'folder') this.toggleFolder(row.path);
        else this.viewFile(row.path);
      },
      startWorkspaceFilePress(row, e) {
        this.cancelWorkspaceFilePress();
        if (!row || row.type !== 'file') return;
        const x = e && e.clientX || 0;
        const y = e && e.clientY || 0;
        this.workspacePressStart = { x, y, path: row.path };
        this.workspacePressTimer = setTimeout(() => {
          this.workspacePressTimer = null;
          this.markWorkspaceLongPressFired();
          U.vibrate(18);
          this.exportWorkspaceFileByName(row.path);
        }, 520);
      },
      moveWorkspaceFilePress(e) {
        if (!this.workspacePressTimer || !this.workspacePressStart || !e) return;
        const dx = Math.abs((e.clientX || 0) - this.workspacePressStart.x);
        const dy = Math.abs((e.clientY || 0) - this.workspacePressStart.y);
        if (dx > 10 || dy > 10) this.cancelWorkspaceFilePress();
      },
      cancelWorkspaceFilePress() {
        if (this.workspacePressTimer) clearTimeout(this.workspacePressTimer);
        this.workspacePressTimer = null;
        this.workspacePressStart = null;
      },
      markWorkspaceLongPressFired() {
        this.workspaceLongPressFired = true;
        if (this.workspacePressBlockTimer) clearTimeout(this.workspacePressBlockTimer);
        this.workspacePressBlockTimer = setTimeout(() => {
          this.workspaceLongPressFired = false;
          this.workspacePressBlockTimer = null;
        }, 900);
      },
      showWorkspaceFileContext(row) {
        if (!row || row.type !== 'file') return;
        this.cancelWorkspaceFilePress();
        this.markWorkspaceLongPressFired();
        this.exportWorkspaceFileByName(row.path);
      },
      toolPermissionKey(name) {
        if (name === 'run_js') return 'run_js';
        if (name === 'web_fetch') return 'web_fetch';
        if (name === 'image_go' || name === 'image_generation') return 'image_go';
        if (name === 'delete_file') return 'delete_files';
        if (name === 'run_service' || name === 'stop_service' || name === 'list_services') return 'services';
        if (name === 'read_file' || name === 'write_file' || name === 'edit_file' || name === 'list_files' ||
          name === 'create_folder' || name === 'move_path' || name === 'path_exists' || name === 'preview_file' || name === 'create_workspace') return 'files';
        return 'files';
      },
      toolPermissionLabel(name) {
        const map = {
          run_js: 'JavaScript 沙盒',
          web_fetch: '网页访问',
          image_go: '图片生成',
          delete_files: '删除工作区文件/文件夹',
          services: '工作区服务',
          files: '工作区文件'
        };
        return map[this.toolPermissionKey(name)] || this.toolLabel(name);
      },
      toolPermission(nameOrKey) {
        const key = ['run_js', 'files', 'delete_files', 'services', 'web_fetch', 'image_go'].includes(nameOrKey)
          ? nameOrKey
          : this.toolPermissionKey(nameOrKey);
        const perms = this.settings.toolPermissions || {};
        if (key === 'image_go') return perms[key] || this.settings.imagePermission || 'ask';
        return perms[key] || (key === 'web_fetch' ? (this.settings.webFetch || 'ask') : 'ask');
      },
      setToolPermission(key, mode) {
        if (key === 'delete_files' && mode === 'always') mode = 'ask';
        this.settings.toolPermissions = Object.assign({}, this.settings.toolPermissions || {}, { [key]: mode });
        if (key === 'web_fetch') this.settings.webFetch = mode;
        if (key === 'image_go') this.settings.imagePermission = mode;
        this.persistSettings();
      },

      pageIs(name) {
        return this.pages[this.pages.length - 1] === name;
      },
      pushPage(name) {
        this.sheet = '';
        this.pages.push(name);
      },
      closePage() {
        this.pages.pop();
      },
      openSettings() {
        this.pushPage('settings');
      },
      openModeSettings() {
        if (this.appMode === 'image') this.sheet = 'imageWorkbench';
        else this.sheet = 'model';
      },
      async openFilesSheet() {
        this.sheet = 'files';
      },
  };
})();
