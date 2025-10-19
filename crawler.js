class ProfessionalWebCrawler {
    constructor() {
        this.visitedUrls = new Set();
        this.urlsToCrawl = new Set();
        this.failedUrls = new Set();
        this.isCrawling = false;
        this.isPaused = false;
        this.stats = {
            totalDiscovered: 0,
            successfullyCrawled: 0,
            failed: 0,
            duplicates: 0,
            external: 0
        };
        
        this.config = {
            maxPages: 500,
            delay: 200,
            usePuppeteer: true
        };
    }

    async startCrawling(startUrl) {
        if (!this.isValidUrl(startUrl)) {
            throw new Error('Некорректный URL');
        }

        this.resetState();
        this.isCrawling = true;
        this.isPaused = false;
        
        const baseUrl = this.normalizeUrl(startUrl);
        this.urlsToCrawl.add(baseUrl);
        
        this.log('🚀 Запуск профессионального краулера...', 'info');
        this.log(`🎯 Цель: ${baseUrl}`, 'info');
        this.log(`📊 Лимит: ${this.config.maxPages} страниц`, 'info');

        try {
            await this.crawlAllPages(baseUrl);
            this.completeCrawling();
        } catch (error) {
            this.log(`❌ Ошибка: ${error.message}`, 'error');
            this.stopCrawling();
        }
    }

    async crawlAllPages(baseUrl) {
        while (this.urlsToCrawl.size > 0 && 
               this.isCrawling && 
               this.visitedUrls.size < this.config.maxPages) {
            
            if (this.isPaused) {
                await this.delay(100);
                continue;
            }

            const currentUrl = Array.from(this.urlsToCrawl)[0];
            this.urlsToCrawl.delete(currentUrl);
            
            await this.crawlSinglePage(currentUrl, baseUrl);
            this.updateProgress();
            
            await this.delay(this.config.delay);
        }
    }

    async crawlSinglePage(url, baseUrl) {
        if (this.visitedUrls.has(url)) return;
        
        this.visitedUrls.add(url);
        this.log(`📄 Обработка: ${url}`, 'crawl');

        try {
            let content, finalUrl;

            if (this.config.usePuppeteer && await this.isJavascriptSite(url)) {
                ({ content, finalUrl } = await this.fetchWithPuppeteer(url));
            } else {
                ({ content, finalUrl } = await this.fetchWithProxy(url));
            }

            // Обработка редиректов
            if (finalUrl !== url) {
                this.log(`🔄 Редирект: ${url} → ${finalUrl}`, 'redirect');
                this.stats.duplicates++;
            }

            this.stats.successfullyCrawled++;
            
            // Извлекаем ссылки
            const newUrls = this.extractUrlsFromHtml(content, finalUrl || url);
            this.processNewUrls(newUrls, baseUrl);

        } catch (error) {
            this.log(`❌ Ошибка: ${url} - ${error.message}`, 'error');
            this.failedUrls.add(url);
            this.stats.failed++;
        }
    }

    async fetchWithProxy(url) {
        const proxies = [
            `https://corsproxy.io/?${encodeURIComponent(url)}`,
            `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
            `https://proxy.cors.sh/${url}`
        ];

        for (const proxyUrl of proxies) {
            try {
                const response = await fetch(proxyUrl, {
                    method: 'GET',
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (compatible; ProfessionalWebCrawler/1.0)',
                        'Accept': 'text/html,application/xhtml+xml,application/xml'
                    }
                });

                if (response.ok) {
                    const content = await response.text();
                    return { content, finalUrl: url };
                }
            } catch (error) {
                continue;
            }
        }
        
        throw new Error('Все прокси серверы недоступны');
    }

    async fetchWithPuppeteer(url) {
        // Эмуляция Puppeteer через iframe и postMessage
        return new Promise((resolve, reject) => {
            const iframe = document.createElement('iframe');
            iframe.style.display = 'none';
            iframe.sandbox = 'allow-scripts allow-same-origin';
            iframe.srcdoc = `
                <html>
                <head>
                    <script>
                        window.addEventListener('message', async (event) => {
                            if (event.data.type === 'crawl') {
                                try {
                                    const response = await fetch(event.data.url);
                                    const html = await response.text();
                                    window.parent.postMessage({
                                        type: 'crawlResult',
                                        success: true,
                                        url: event.data.url,
                                        content: html
                                    }, '*');
                                } catch (error) {
                                    window.parent.postMessage({
                                        type: 'crawlResult', 
                                        success: false,
                                        error: error.message
                                    }, '*');
                                }
                            }
                        });
                    </script>
                </head>
                <body></body>
                </html>
            `;
            
            const timeout = setTimeout(() => {
                document.body.removeChild(iframe);
                reject(new Error('Timeout'));
            }, 10000);

            window.addEventListener('message', (event) => {
                if (event.data.type === 'crawlResult') {
                    clearTimeout(timeout);
                    document.body.removeChild(iframe);
                    
                    if (event.data.success) {
                        resolve({
                            content: event.data.content,
                            finalUrl: event.data.url
                        });
                    } else {
                        reject(new Error(event.data.error));
                    }
                }
            });

            document.body.appendChild(iframe);
            iframe.contentWindow.postMessage({ type: 'crawl', url }, '*');
        });
    }

    async isJavascriptSite(url) {
        try {
            const response = await fetch(`https://corsproxy.io/?${encodeURIComponent(url)}`);
            const html = await response.text();
            return html.includes('<script') && 
                  (html.includes('react') || html.includes('vue') || html.includes('angular'));
        } catch {
            return false;
        }
    }

    extractUrlsFromHtml(html, baseUrl) {
        const urls = new Set();
        const patterns = [
            /<a\s+(?:[^>]*?\s+)?href=(["'])(.*?)\1/gi,
            /<link\s+(?:[^>]*?\s+)?href=(["'])(.*?)\1/gi,
            /<img\s+(?:[^>]*?\s+)?src=(["'])(.*?)\1/gi,
            /<script\s+(?:[^>]*?\s+)?src=(["'])(.*?)\1/gi,
            /<iframe\s+(?:[^>]*?\s+)?src=(["'])(.*?)\1/gi
        ];

        patterns.forEach(pattern => {
            let match;
            while ((match = pattern.exec(html)) !== null) {
                const href = match[2];
                if (href) {
                    try {
                        const absoluteUrl = new URL(href, baseUrl).href;
                        urls.add(absoluteUrl);
                    } catch (e) {
                        // Ignore invalid URLs
                    }
                }
            }
        });

        return Array.from(urls);
    }

    processNewUrls(newUrls, baseUrl) {
        newUrls.forEach(url => {
            this.stats.totalDiscovered++;
            
            const normalizedUrl = this.normalizeUrl(url);
            
            if (!this.isSameDomain(normalizedUrl, baseUrl)) {
                this.stats.external++;
                return;
            }

            if (this.visitedUrls.has(normalizedUrl) || 
                this.urlsToCrawl.has(normalizedUrl) ||
                this.failedUrls.has(normalizedUrl)) {
                this.stats.duplicates++;
                return;
            }

            if (this.shouldCrawlUrl(normalizedUrl)) {
                this.urlsToCrawl.add(normalizedUrl);
                this.log(`🔍 Найдена новая страница: ${normalizedUrl}`, 'discover');
            }
        });
    }

    normalizeUrl(url) {
        try {
            const urlObj = new URL(url);
            urlObj.protocol = urlObj.protocol.toLowerCase();
            urlObj.hostname = urlObj.hostname.toLowerCase().replace(/^www\./, '');
            urlObj.hash = '';
            
            urlObj.pathname = urlObj.pathname
                .replace(/\/+/g, '/')
                .replace(/\/$/, '') || '/';
            
            if (urlObj.search) {
                const params = new URLSearchParams(urlObj.search);
                const importantParams = new URLSearchParams();
                
                for (const [key, value] of params) {
                    if (!key.match(/^(utm_|fbclid|gclid|msclkid|trk_|ref|source)/i)) {
                        importantParams.append(key, value);
                    }
                }
                
                urlObj.search = importantParams.toString();
            }
            
            return urlObj.href;
        } catch (error) {
            return url;
        }
    }

    shouldCrawlUrl(url) {
        if (!this.isValidPageUrl(url)) return false;
        if (this.visitedUrls.size >= this.config.maxPages) return false;
        
        const excludedPaths = ['/admin', '/login', '/logout', '/register', '/api/'];
        const urlLower = url.toLowerCase();
        return !excludedPaths.some(path => urlLower.includes(path));
    }

    isValidPageUrl(url) {
        try {
            const urlObj = new URL(url);
            const excludedExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.zip'];
            const pathname = urlObj.pathname.toLowerCase();
            
            if (excludedExtensions.some(ext => pathname.endsWith(ext))) {
                return false;
            }
            
            if (['mailto:', 'tel:', 'javascript:', 'ftp:', 'data:'].some(proto => 
                url.toLowerCase().startsWith(proto))) {
                return false;
            }
            
            return ['http:', 'https:'].includes(urlObj.protocol);
            
        } catch (error) {
            return false;
        }
    }

    isSameDomain(url, baseUrl) {
        try {
            return new URL(url).hostname === new URL(baseUrl).hostname;
        } catch {
            return false;
        }
    }

    isValidUrl(string) {
        try {
            new URL(string);
            return true;
        } catch (_) {
            return false;
        }
    }

    updateProgress() {
        const totalProcessed = this.visitedUrls.size + this.failedUrls.size;
        const progress = (totalProcessed / this.config.maxPages) * 100;
        
        // Обновляем UI
        if (typeof updateUI === 'function') {
            updateUI({
                progress: Math.min(progress, 100),
                stats: this.stats,
                visited: this.visitedUrls.size,
                queued: this.urlsToCrawl.size,
                failed: this.failedUrls.size
            });
        }
    }

    log(message, type = 'info') {
        if (typeof addLog === 'function') {
            addLog(message, type);
        }
    }

    completeCrawling() {
        this.isCrawling = false;
        this.log('✅ Сбор страниц завершен!', 'success');
        this.log(`📊 Итоговая статистика:`, 'success');
        this.log(`   ✅ Успешно: ${this.visitedUrls.size} страниц`, 'success');
        this.log(`   ❌ Ошибки: ${this.failedUrls.size} страниц`, 'success');
        this.log(`   🔄 Дубликатов: ${this.stats.duplicates}`, 'success');
        
        if (typeof showResults === 'function') {
            showResults(this.getResults());
        }
    }

    stopCrawling() {
        this.isCrawling = false;
        this.isPaused = false;
        this.log('⏹️ Сбор страниц остановлен', 'warning');
    }

    togglePause() {
        this.isPaused = !this.isPaused;
        this.log(this.isPaused ? '⏸️ Пауза' : '▶️ Продолжено', 'info');
    }

    resetState() {
        this.visitedUrls.clear();
        this.urlsToCrawl.clear();
        this.failedUrls.clear();
        this.stats = {
            totalDiscovered: 0,
            successfullyCrawled: 0,
            failed: 0,
            duplicates: 0,
            external: 0
        };
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    getResults() {
        return {
            urls: Array.from(this.visitedUrls).sort(),
            stats: this.stats,
            failedUrls: Array.from(this.failedUrls),
            totalPages: this.visitedUrls.size
        };
    }

    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
    }
}

// Глобальный инстанс краулера
const professionalCrawler = new ProfessionalWebCrawler();

// UI функции
function updateUI(data) {
    const progressFill = document.getElementById('progressFill');
    const progressInfo = document.getElementById('progressInfo');
    const statsGrid = document.getElementById('statsGrid');
    
    // Прогресс бар
    progressFill.style.width = data.progress + '%';
    
    // Информация
    progressInfo.innerHTML = `
        <strong>${data.visited}</strong> обработано | 
        <strong>${data.queued}</strong> в очереди | 
        <strong>${data.failed}</strong> ошибок
    `;
    
    // Статистика
    statsGrid.innerHTML = `
        <div class="stat-card">
            <div class="stat-number">${data.visited}</div>
            <div class="stat-label">Успешно</div>
        </div>
        <div class="stat-card">
            <div class="stat-number">${data.queued}</div>
            <div class="stat-label">В очереди</div>
        </div>
        <div class="stat-card">
            <div class="stat-number">${data.failed}</div>
            <div class="stat-label">Ошибки</div>
        </div>
        <div class="stat-card">
            <div class="stat-number">${data.stats.duplicates}</div>
            <div class="stat-label">Дубликаты</div>
        </div>
    `;
}

function addLog(message, type = 'info') {
    const logElement = document.getElementById('log');
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry log-${type}`;
    logEntry.innerHTML = `<span class="log-time">[${timestamp}]</span> ${message}`;
    logElement.appendChild(logEntry);
    logElement.scrollTop = logElement.scrollHeight;
}

function showResults(results) {
    document.getElementById('progressSection').style.display = 'none';
    document.getElementById('resultsSection').style.display = 'block';
    
    const statsHtml = `
        <div class="final-stats">
            <div class="stat-item">✅ <strong>Успешно собрано:</strong> ${results.totalPages} страниц</div>
            <div class="stat-item">❌ <strong>Ошибки:</strong> ${results.failedUrls.length} страниц</div>
            <div class="stat-item">🔄 <strong>Найдено дубликатов:</strong> ${results.stats.duplicates}</div>
            <div class="stat-item">🌐 <strong>Внешних ссылок:</strong> ${results.stats.external}</div>
        </div>
    `;
    
    document.getElementById('resultsStats').innerHTML = statsHtml;
}

// Экспорт функций
function startCrawling() {
    const url = document.getElementById('urlInput').value.trim();
    const maxPages = parseInt(document.getElementById('maxPages').value) || 500;
    const delay = parseInt(document.getElementById('delay').value) || 200;
    const usePuppeteer = document.getElementById('usePuppeteer').checked;
    
    if (!url) {
        showError('Введите URL сайта');
        return;
    }
    
    // Сброс UI
    document.getElementById('error').textContent = '';
    document.getElementById('progressSection').style.display = 'block';
    document.getElementById('resultsSection').style.display = 'none';
    document.getElementById('crawlBtn').style.display = 'none';
    document.getElementById('stopBtn').style.display = 'inline-block';
    document.getElementById('pauseBtn').style.display = 'inline-block';
    document.getElementById('log').innerHTML = '';
    
    // Обновление конфигурации
    professionalCrawler.updateConfig({ maxPages, delay, usePuppeteer });
    
    // Запуск
    professionalCrawler.startCrawling(url).catch(error => {
        showError(error.message);
    });
}

function stopCrawling() {
    professionalCrawler.stopCrawling();
    document.getElementById('crawlBtn').style.display = 'inline-block';
    document.getElementById('stopBtn').style.display = 'none';
    document.getElementById('pauseBtn').style.display = 'none';
}

function togglePause() {
    professionalCrawler.togglePause();
    const pauseBtn = document.getElementById('pauseBtn');
    pauseBtn.textContent = professionalCrawler.isPaused ? '▶️ Продолжить' : '⏸️ Пауза';
}

function showError(message) {
    document.getElementById('error').textContent = message;
    addLog(`❌ ${message}`, 'error');
}

function exportCSV() {
    const results = professionalCrawler.getResults();
    const csvContent = ['URL', ...results.urls].join('\n');
    downloadFile(csvContent, 'crawled_pages.csv', 'text/csv');
}

function exportJSON() {
    const results = professionalCrawler.getResults();
    const jsonContent = JSON.stringify(results, null, 2);
    downloadFile(jsonContent, 'crawled_pages.json', 'application/json');
}

function exportTXT() {
    const results = professionalCrawler.getResults();
    const txtContent = results.urls.join('\n');
    downloadFile(txtContent, 'crawled_pages.txt', 'text/plain');
}

function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    addLog(`📥 Файл ${filename} скачан`, 'success');
}

function viewResults() {
    const results = professionalCrawler.getResults();
    const urlsContainer = document.getElementById('urlsContainer');
    const urlsList = document.getElementById('urlsList');
    
    urlsContainer.innerHTML = '';
    results.urls.forEach(url => {
        const urlElement = document.createElement('div');
        urlElement.className = 'url-item';
        urlElement.innerHTML = `<a href="${url}" target="_blank">${url}</a>`;
        urlsContainer.appendChild(urlElement);
    });
    
    urlsList.style.display = 'block';
}

// Обработчики событий
document.getElementById('urlInput').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') startCrawling();
});
