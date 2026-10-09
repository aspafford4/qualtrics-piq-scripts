/* PIQ dynamic response renderer: original logic moved from QID2163. */
(function () {
if (!window.PIQDynamicRenderer) {
    window.PIQDynamicRenderer = (function () {
        var MAX_REVIEW_RESPONSES = 60;
        var cachedRosterText = null;
        var cachedRoster = null;
        var visibleCacheRoster = null;
        var visibleCacheKey = null;
        var visibleCacheRecords = null;
        var arrayCache = Object.create(null);
        var arrayCacheSize = 0;

        // In-memory only: never persist employee data in browser storage.
        // The actual source text is part of every cache comparison.
        function readRoster(raw) {
            if (cachedRosterText !== raw) {
                cachedRosterText = raw;
                cachedRoster = parseJson(raw);
                visibleCacheRoster = null;
            }
            return cachedRoster;
        }

        function readAnswerArray(key, raw) {
            var entry = arrayCache[key];
            if (entry && entry.raw === raw) {
                return entry.value;
            }
            if (!entry && arrayCacheSize >= 192) {
                arrayCache = Object.create(null);
                arrayCacheSize = 0;
            }
            if (!arrayCache[key]) {
                arrayCacheSize++;
            }
            var value = parseJson(raw);
            arrayCache[key] = {raw: raw, value: value};
            return value;
        }
        function parseJson(value) {
            var current = String(value || "").trim();
            if (!current) {
                return [];
            }
            for (var attempt = 0; attempt < 2; attempt++) {
                try {
                    var parsed = JSON.parse(current);
                    if (typeof parsed === "string") {
                        current = parsed;
                        continue;
                    }
                    return parsed;
                } catch (err) {
                    break;
                }
            }
            return null;
        }

        function parseIncluded(value) {
            var result = {};
            String(value || "").split("|").forEach(function (item) {
                var position = String(item || "").trim();
                if (position) {
                    result[position] = true;
                }
            });
            return result;
        }

        function sourceValue(element) {
            return element ? (element.value || element.textContent || "") : "";
        }

        function escapeHtml(value) {
            return String(value)
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/\"/g, "&quot;")
                .replace(/'/g, "&#39;");
        }

        function plainText(value) {
            var raw = String(value == null ? "" : value)
                .replace(/<br\s*\/?\s*>/gi, "\n");
            // Most Yes/No/numeric cells need no HTML decoding.
            if (!/[<&]/.test(raw)) {
                return raw.replace(/\r\n?/g, "\n");
            }
            var holder = document.createElement("div");
            holder.innerHTML = raw;
            return (holder.textContent || holder.innerText || "").replace(/\r\n?/g, "\n");
        }

        function formatValue(value, emptyText) {
            var normalized = plainText(value);
            if (!normalized.trim()) {
                return '<span class="piq-no-response">' + escapeHtml(emptyText) + '</span>';
            }
            return escapeHtml(normalized).replace(/\n/g, "<br>");
        }

        function participantLabel(record, fallbackIndex) {
            return String(record.participantName || ("Respondent " + fallbackIndex)).trim();
        }

        function hasCompletedResponse(record) {
            if (!record || typeof record !== "object") {
                return false;
            }
            var flag = record.hasResponse;
            var normalized = String(flag == null ? "" : flag).trim().toLowerCase();
            if (flag === true || flag === 1 || normalized === "true" || normalized === "1" || normalized === "yes") {
                return true;
            }
            if (flag === false || flag === 0 || normalized === "false" || normalized === "0" || normalized === "no") {
                return false;
            }
            return !!String(record.responseId || "").trim();
        }

        function getVisibleRecords(roster, included) {
            var selectionKey = Object.keys(included).sort().join('|');
            if (visibleCacheRoster === roster && visibleCacheKey === selectionKey) {
                return visibleCacheRecords;
            }
            var selected = roster.filter(function (record) {
                if (!record || typeof record !== 'object') {
                    return false;
                }
                var positionNumber = String(record.positionNumber || '').trim();
                return !!included[positionNumber] && hasCompletedResponse(record);
            }).sort(function (a, b) {
                return Number(a.index || 0) - Number(b.index || 0);
            });
            visibleCacheRoster = roster;
            visibleCacheKey = selectionKey;
            visibleCacheRecords = selected;
            return selected;
        }

        function answerAt(arrays, key, record) {
            var array = arrays[key];
            if (!Array.isArray(array)) {
                return null;
            }
            var index = Number(record.index || 0) - 1;
            return index >= 0 && index < array.length ? array[index] : null;
        }

        function tokenValue(arrays, key, record, mode) {
            var emptyText = mode === "table" ? "—" : "No response provided.";
            if (key === "AKQ1M" && arrays.AKQ1M_OTHER) {
                var selected = answerAt(arrays, "AKQ1M", record);
                var other = answerAt(arrays, "AKQ1M_OTHER", record);
                var selectedText = plainText(selected).trim();
                var otherText = plainText(other).trim();
                if (selectedText && otherText) {
                    return "<strong>Languages selected:</strong> " + formatValue(selectedText, emptyText) +
                        "<br><strong>Other language:</strong> " + formatValue(otherText, emptyText);
                }
                if (selectedText) {
                    return formatValue(selectedText, emptyText);
                }
                if (otherText) {
                    return "<strong>Other language:</strong> " + formatValue(otherText, emptyText);
                }
                return formatValue(null, emptyText);
            }
            return formatValue(answerAt(arrays, key, record), emptyText);
        }

        function replaceTokens(template, arrays, record, displayIndex, mode) {
            var label = escapeHtml(participantLabel(record, displayIndex + 1));
            var output = String(template || "")
                .replace(/\[\[PARTICIPANT_LABEL\]\]/g, label)
                .replace(/\[\[PARTICIPANT_NAME\]\]/g, escapeHtml(record.participantName || ("Respondent " + (displayIndex + 1))))
                .replace(/\[\[POSITION_NUMBER\]\]/g, escapeHtml(record.positionNumber || ""))
                .replace(/\[\[POSITION_TITLE\]\]/g, escapeHtml(record.positionTitle || ""));

            return output.replace(/\[\[FIELD:([^\]]+)\]\]/g, function (_match, key) {
                return tokenValue(arrays, key, record, mode);
            });
        }

        function templateFieldKeys(template) {
            var keys = [];
            var pattern = /\[\[FIELD:([^\]]+)\]\]/g;
            var match = pattern.exec(String(template || ""));
            while (match) {
                if (keys.indexOf(match[1]) === -1) {
                    keys.push(match[1]);
                }
                match = pattern.exec(String(template || ""));
            }
            return keys;
        }

        function hasAnyAnswer(template, arrays, visibleRecords) {
            var keys = templateFieldKeys(template);

            /*
             * A template with no answer tokens is not answer-driven, so it is
             * left to render normally.
             */
            if (!keys.length) {
                return true;
            }

            for (var r = 0; r < visibleRecords.length; r++) {
                for (var k = 0; k < keys.length; k++) {
                    var key = keys[k];

                    if (plainText(answerAt(arrays, key, visibleRecords[r])).trim()) {
                        return true;
                    }

                    // Some fields carry an accompanying free-text companion.
                    if (arrays[key + "_OTHER"] &&
                        plainText(answerAt(arrays, key + "_OTHER", visibleRecords[r])).trim()) {
                        return true;
                    }
                }
            }

            return false;
        }

        function isAffirmativePresenceValue(value) {
            var normalized = plainText(value).trim().toLowerCase();
            return normalized === "yes" || normalized === "1" || normalized === "true";
        }

        function showError(output, message) {
            output.innerHTML = "";
            var error = document.createElement("div");
            error.className = "piq-dynamic-error";
            error.setAttribute("role", "alert");
            error.textContent = message;
            output.appendChild(error);
        }

        function renderSimple(output, template, arrays, visibleRecords) {
            output.innerHTML = "";
            var fragment = document.createDocumentFragment();
            visibleRecords.forEach(function (record, index) {
                var wrapper = document.createElement("div");
                wrapper.className = "piq-dynamic-participant-response";
                wrapper.setAttribute("data-response-id", record.responseId || "");
                wrapper.setAttribute("data-position-number", record.positionNumber || "");
                wrapper.innerHTML = replaceTokens(template, arrays, record, index, "simple");
                fragment.appendChild(wrapper);
            });
            output.appendChild(fragment);
        }

        function renderTable(output, template, arrays, visibleRecords) {
            var staging = document.createElement("div");
            staging.innerHTML = template;
            var tables = staging.querySelectorAll("table");

            for (var tableIndex = 0; tableIndex < tables.length; tableIndex++) {
                var table = tables[tableIndex];
                var templateRows = Array.prototype.slice.call(
                    table.querySelectorAll("tr.piq-template-response-row")
                );
                if (!templateRows.length) {
                    continue;
                }
                var parent = templateRows[0].parentNode;
                var marker = templateRows[0];
                var staticCellDefinitions = [];

                // A response-row cell with visible text but no [[...]] token is
                // fixed survey text, such as an activity or skill title. Mark it
                // so one copy can span every rendered respondent row.
                templateRows.forEach(function (row, rowIndex) {
                    var cells = Array.prototype.slice.call(row.children || []);
                    cells.forEach(function (cell, cellIndex) {
                        var markup = String(cell.outerHTML || "");
                        var visibleText = String(cell.textContent || "")
                            .replace(/ /g, " ")
                            .trim();
                        if (markup.indexOf("[[") !== -1 || !visibleText) {
                            return;
                        }

                        var key = "piq-static-" + tableIndex + "-" + rowIndex + "-" + cellIndex;
                        var originalRowspan = parseInt(cell.getAttribute("rowspan") || "1", 10);
                        if (!originalRowspan || originalRowspan < 1) {
                            originalRowspan = 1;
                        }
                        cell.setAttribute("data-piq-static-key", key);
                        staticCellDefinitions.push({
                            key: key,
                            rowspan: originalRowspan
                        });
                    });
                });

                var rowTemplates = templateRows.map(function (row) {
                    return row.outerHTML;
                });

                var renderedRows = [];
                visibleRecords.forEach(function (record, index) {
                    rowTemplates.forEach(function (rowTemplate) {
                        renderedRows.push(replaceTokens(rowTemplate, arrays, record, index, 'table'));
                    });
                });
                // Parse the entire detached row group once rather than creating
                // a temporary table for every respondent in every activity.
                var stagingTable = document.createElement('table');
                var stagingBody = document.createElement('tbody');
                stagingTable.appendChild(stagingBody);
                stagingBody.innerHTML = renderedRows.join('');
                var fragment = document.createDocumentFragment();
                var renderedRowIndex = 0;
                while (stagingBody.firstElementChild) {
                    var row = stagingBody.firstElementChild;
                    var record = visibleRecords[Math.floor(renderedRowIndex / rowTemplates.length)];
                    row.classList.remove('piq-template-response-row');
                    row.classList.add('piq-dynamic-response-row');
                    row.setAttribute('data-response-id', record.responseId || '');
                    row.setAttribute('data-position-number', record.positionNumber || '');
                    fragment.appendChild(row);
                    renderedRowIndex++;
                }
                parent.insertBefore(fragment, marker);

                templateRows.forEach(function (row) {
                    if (row.parentNode) {
                        row.parentNode.removeChild(row);
                    }
                });

                // Keep the first copy of each fixed survey-text cell, extend its
                // rowspan across all respondents, and remove the duplicate cells.
                staticCellDefinitions.forEach(function (definition) {
                    var copies = parent.querySelectorAll(
                        '[data-piq-static-key="' + definition.key + '"]'
                    );
                    if (!copies.length) {
                        return;
                    }

                    var first = copies[0];
                    first.setAttribute(
                        "rowspan",
                        String(definition.rowspan * visibleRecords.length)
                    );
                    first.classList.add("piq-shared-static-cell");
                    first.removeAttribute("data-piq-static-key");

                    for (var copyIndex = copies.length - 1; copyIndex >= 1; copyIndex--) {
                        if (copies[copyIndex].parentNode) {
                            copies[copyIndex].parentNode.removeChild(copies[copyIndex]);
                        }
                    }
                });
            }

            output.innerHTML = "";
            var scroll = document.createElement("div");
            scroll.className = "piq-dynamic-table-scroll";
            while (staging.firstChild) {
                scroll.appendChild(staging.firstChild);
            }
            output.appendChild(scroll);
        }

        function render(question) {
            var container = question.getQuestionContainer();
            if (!container) {
                return;
            }
            var output = container.querySelector('.piq-dynamic-response-output');
            var templateSource = container.querySelector('.piq-dynamic-template-source');
            if (!output || !templateSource) {
                return;
            }

            var presenceKey = output.getAttribute('data-piq-presence-key') || '';
            var presenceArrayKey = output.getAttribute('data-piq-presence-array-key') || presenceKey;
            var customNoAnswerMessage = output.getAttribute('data-piq-no-answer-message') || '';
            var expectedCount = null;

            // Additional-item visibility is decided by saved Embedded Data,
            // not by manipulating a native required question on this page.
            if (presenceKey) {
                var flagSource = container.querySelector('.piq-dynamic-presence-flag-source');
                var countSource = container.querySelector('.piq-dynamic-presence-count-source');
                var flagText = String(sourceValue(flagSource)).trim().toLowerCase();
                var countText = String(sourceValue(countSource)).trim();
                expectedCount = Number(countText);
                if (!flagSource || !countSource || countText === '' ||
                    !isFinite(expectedCount) || expectedCount < 0 ||
                    Math.floor(expectedCount) !== expectedCount ||
                    (flagText === 'true') !== (expectedCount > 0)) {
                    showError(output, 'Additional-activity display data is unavailable. Please restart the form from Position Confirmation or contact the survey administrator.');
                    return;
                }
                if (expectedCount === 0) {
                    output.innerHTML = '';
                    var message = document.createElement('div');
                    message.className = 'piq-no-additional-responses';
                    message.style.cssText = 'color:#000000;font-weight:700;background:none;border:0;padding:0;margin:8px 0 18px 0;';
                    message.textContent = customNoAnswerMessage;
                    output.appendChild(message);
                    return;
                }
            }

            var roster = readRoster(sourceValue(container.querySelector('.piq-dynamic-roster-source')));
            var included = parseIncluded(sourceValue(container.querySelector('.piq-dynamic-included-source')));
            if (!Array.isArray(roster)) {
                showError(output, 'Unable to load the employee response roster. Please contact the survey administrator.');
                return;
            }
            var arrays = {};
            var sources = container.querySelectorAll('.piq-dynamic-answer-source[data-key]');
            for (var sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
                var source = sources[sourceIndex];
                var key = source.getAttribute('data-key');
                var parsed = readAnswerArray(key, sourceValue(source));
                if (!Array.isArray(parsed)) {
                    showError(output, 'Unable to load one or more employee response fields. Please contact the survey administrator.');
                    return;
                }
                arrays[key] = parsed;
            }

            var visibleRecords = getVisibleRecords(roster, included);
            if (visibleRecords.length > MAX_REVIEW_RESPONSES) {
                showError(output, 'This form exceeds the supported maximum of 60 completed employee responses. Please contact the survey administrator.');
                return;
            }
            var seenIndexes = Object.create(null);
            var arrayKeys = Object.keys(arrays);
            for (var recordIndex = 0; recordIndex < visibleRecords.length; recordIndex++) {
                var sourceIndex = Number(visibleRecords[recordIndex].index) - 1;
                if (!isFinite(sourceIndex) || Math.floor(sourceIndex) !== sourceIndex ||
                    sourceIndex < 0 || seenIndexes[sourceIndex]) {
                    showError(output, 'The employee roster contains invalid or repeated response indexes. Please contact the survey administrator.');
                    return;
                }
                seenIndexes[sourceIndex] = true;
                for (var fieldIndex = 0; fieldIndex < arrayKeys.length; fieldIndex++) {
                    if (sourceIndex >= arrays[arrayKeys[fieldIndex]].length) {
                        showError(output, 'An employee response array is incomplete or does not match the roster. Please contact the survey administrator.');
                        return;
                    }
                }
            }
            var template = sourceValue(templateSource);
            var renderRecords = visibleRecords;
            if (presenceKey) {
                // Retain the row-level Yes filter: the saved count cannot identify
                // which individual employees belong in this table.
                renderRecords = visibleRecords.filter(function (record) {
                    return isAffirmativePresenceValue(answerAt(arrays, presenceArrayKey, record));
                });
                if (renderRecords.length !== expectedCount) {
                    showError(output, 'The additional-activity table does not match the saved review selection. Please restart the form or contact the survey administrator.');
                    return;
                }
            } else {
                if (!visibleRecords.length) {
                    output.innerHTML = '<div class="piq-no-included-responses">No employee PIQ responses are available for the positions retained in this review.</div>';
                    return;
                }
                if (!hasAnyAnswer(template, arrays, visibleRecords)) {
                    output.innerHTML = '<div class="piq-no-included-responses">No answers were provided.</div>';
                    return;
                }
            }

            var mode = output.getAttribute('data-mode') || 'simple';
            if (mode === 'table') {
                renderTable(output, template, arrays, renderRecords);
            } else {
                renderSimple(output, template, arrays, renderRecords);
            }
        }

        return {render: render};
    })();
}
})();
