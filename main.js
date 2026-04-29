// ============================================================================
// SHARED CONFIGURATION & UTILITIES
// ============================================================================

const ALLOWED_CHARACTERS = [
  "Jeff",
  "Annie",
  "Abed",
  "Britta",
  "Troy",
  "Pierce",
  "Shirley",
  "Duncan",
  "Chang",
  "Pelton",
];

const colorScale = d3.scaleOrdinal()
    .domain(ALLOWED_CHARACTERS)
    .range([
        "#1f77b4",  // Jeff - blue
        "#e377c2",  // Annie - pink
        "#ff7f0e",  // Abed - orange
        "#d62728",  // Britta - red
        "#9467bd",  // Troy - purple
        "#8c564b",  // Pierce - brown
        "#2ca02c",  // Shirley - green
        "#17becf",  // Duncan - teal
        "#7f7f7f",  // Chang - gray
        "#bcbd22",  // Pelton - olive
    ]);

// DOM elements
const datasetSelect = document.getElementById("datasetSelect");
const statusText = document.getElementById("statusText");
const speakerList = document.getElementById("speakerList");
const tooltip = d3.select("#tooltip");

// Chart dimensions
const chordWidth = 1200;
const chordHeight = 900;
const centerX = chordWidth / 2;
const centerY = chordHeight / 2;
const outerRadius = Math.min(chordWidth, chordHeight) * 0.40;
const innerRadius = outerRadius - 50;

// State
let allDatasets = [];
let characterLinesData = null;

function cleanValue(value) {
  return (value || "").trim();
}

function normalizeName(name) {
  return cleanValue(name).replace(/^"|"$/g, "");
}

function canonicalizeCharacter(name) {
  const raw = normalizeName(name);
  const lower = raw.toLowerCase();

  if (lower.includes("jeff")) return "Jeff";
  if (lower.includes("abed")) return "Abed";
  if (lower.includes("shirley")) return "Shirley";
  if (lower.includes("britta")) return "Britta";
  if (lower.includes("troy")) return "Troy";
  if (lower.includes("pierce")) return "Pierce";
  if (lower.includes("duncan")) return "Duncan";
  if (lower.includes("chang")) return "Chang";
  if (lower.includes("pelton")) return "Pelton";

  return null;
}

function parseTranscript(rows) {
  const cleaned = rows
    .map((row) => ({
      character: canonicalizeCharacter(row.character || row.Character || row["character"] || row["Character"]),
      line: cleanValue(row.line || row.Line || row["line"] || row["Line"]),
      episodeKey: cleanValue(row.__episode || row.episode || row.Episode || "single"),
    }))
    .filter((row) => row.character && row.line);

  const totals = new Map();
  const edges = new Map();

  let previousSpeaker = null;
  let previousEpisode = null;

  for (const row of cleaned) {
    const wordCount = row.line.split(/\s+/).filter(Boolean).length;
    totals.set(row.character, (totals.get(row.character) || 0) + wordCount);

    if (previousSpeaker && previousEpisode === row.episodeKey && previousSpeaker !== row.character) {
      const edgeKey = `${previousSpeaker}|||${row.character}`;
      edges.set(edgeKey, (edges.get(edgeKey) || 0) + 1);
    }

    previousSpeaker = row.character;
    previousEpisode = row.episodeKey;
  }

  return {
    rows: cleaned,
    totals,
    edges,
  };
}

async function loadIndex() {
  const response = await fetch("all_scripts/index.json");
  if (!response.ok) {
    throw new Error("Unable to load all_scripts/index.json");
  }
  return response.json();
}

async function loadCsvFile(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load ${path}`);
  }
  return d3.csvParse(await response.text());
}

async function loadCharacterLinesData() {
  const response = await fetch("all_scripts/character_lines_data.json");
  if (!response.ok) {
    throw new Error("Unable to load all_scripts/character_lines_data.json");
  }
  return response.json();
}

async function buildDatasetList() {
  const entries = await loadIndex();
  const datasets = [];

  for (const entry of entries) {
    const csvPath = `all_scripts/${entry.file}`;
    const rows = await loadCsvFile(csvPath);
    datasets.push({
      id: entry.episode || entry.file.replace(/\.csv$/i, ""),
      label: entry.episode ? (() => {
        const m = entry.episode.match(/^(\d+)x(\d+)\s*(.*)/);
        return m ? `S${m[1]} E${m[2]} — ${m[3]}` : entry.episode;
      })() : entry.file.replace(/\.csv$/i, "").replace(/_/g, " "),
      file: entry.file,
      rows,
    });
  }

  datasets.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  return datasets;
}

function makeAllEpisodesDataset(datasets) {
  const mergedRows = datasets.flatMap((dataset) =>
    dataset.rows.map((row) => ({ ...row, __episode: dataset.id }))
  );
  return {
    id: "all",
    label: "All episodes",
    rows: mergedRows,
  };
}

function extractSeason(episodeId) {
  // Episode IDs are like "1x1", "2x10", etc.
  const match = episodeId.match(/^(\d+)x/);
  return match ? parseInt(match[1]) : null;
}

function makeSeasonDatasets(datasets) {
  const seasonGroups = new Map();

  // Group datasets by season
  for (const dataset of datasets) {
    const season = extractSeason(dataset.id);
    if (season && season >= 1 && season <= 6) {
      if (!seasonGroups.has(season)) {
        seasonGroups.set(season, []);
      }
      seasonGroups.get(season).push(dataset);
    }
  }

  // Create season datasets
  const seasonDatasets = [];
  for (let season = 1; season <= 6; season++) {
    const episodesInSeason = seasonGroups.get(season) || [];
    if (episodesInSeason.length > 0) {
      const mergedRows = episodesInSeason.flatMap((dataset) =>
        dataset.rows.map((row) => ({ ...row, __episode: dataset.id }))
      );
      seasonDatasets.push({
        id: `season_${season}`,
        label: `Season ${season}`,
        rows: mergedRows,
      });
    }
  }

  return seasonDatasets;
}

// ============================================================================
// STACKED AREA CHART
// ============================================================================

function renderStackedAreaChart(dataset) {
  // Only render if we have character lines data
  if (!characterLinesData) {
    console.warn("Character lines data not loaded");
    return;
  }

  const margin = { top: 20, right: 30, bottom: 110, left: 60 };
  const svgWidth = document.getElementById("stackedAreaChart").parentElement.clientWidth;
  const width = svgWidth - margin.left - margin.right;
  const height = 450 - margin.top - margin.bottom;

  // Clear previous chart
  d3.select("#stackedAreaChart").selectAll("*").remove();

  // Create SVG
  const svg = d3.select("#stackedAreaChart")
    .attr("width", width + margin.left + margin.right)
    .attr("height", height + margin.top + margin.bottom)
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const episodes = characterLinesData.episodes;
  const characters = characterLinesData.characters;

  // Check if single episode is selected (not "all" and not a season like "season_1")
  const isSingleEpisode = dataset && dataset.id !== "all" && !dataset.id.startsWith("season_");
  
  // Check if a season is selected
  const isSeason = dataset && dataset.id.startsWith("season_");
  const selectedSeason = isSeason ? parseInt(dataset.id.split("_")[1]) : null;
  
  // Filter episodes if season is selected
  let filteredEpisodes = episodes;
  if (isSeason && selectedSeason) {
    filteredEpisodes = episodes.filter(ep => {
      const epSeason = extractSeason(ep.name);
      return epSeason === selectedSeason;
    });
  }
  
  let stackedData;
  
  if (isSingleEpisode) {
    // For single episode, find the matching episode and show as single data point
    const episodeName = dataset.id.trim();
    const episode = episodes.find(ep => ep.name === episodeName);
    
    if (!episode) {
      svg.append("text")
        .attr("x", width / 2)
        .attr("y", height / 2)
        .attr("text-anchor", "middle")
        .attr("fill", "#999")
        .text("No character data found for this episode");
      return;
    }
    
    // Create single data point for this episode
    const obj = {
      episode: episode.name,
      index: 0
    };
    
    episode.characters.forEach(char => {
      obj[char.name] = char.percentage;
    });
    
    stackedData = [obj];
  } else {
    // For all episodes or seasons, use filtered episodes
    stackedData = filteredEpisodes.map((ep, index) => {
      const obj = {
        episode: ep.name,
        index: index
      };
      
      ep.characters.forEach(char => {
        obj[char.name] = char.percentage;
      });
      
      return obj;
    });
  }

  // Create scales
  const xScale = d3.scaleLinear().range([0, width]);
  const yScale = d3.scaleLinear().range([height, 0]);

  // Set up domains
  if (isSingleEpisode) {
    xScale.domain([-0.5, 0.5]);
  } else {
    xScale.domain([0, filteredEpisodes.length - 1]);
  }
  yScale.domain([0, 100]);

  // Create stack generator
  const stack = d3.stack()
    .keys(characters);

  const stackedSeries = stack(stackedData);

  // If single episode, render pie chart instead of area
  if (isSingleEpisode) {
    renderStackedBar(svg, stackedSeries, stackedData, xScale, yScale, width, height, margin);
    
    // Add axis labels for pie chart
    svg.append("text")
      .attr("class", "axis-label")
      .attr("text-anchor", "middle")
      .attr("x", width / 2)
      .attr("y", height + 50)
      .text("Character Distribution");

    svg.append("text")
      .attr("class", "axis-label")
      .attr("text-anchor", "middle")
      .attr("transform", "rotate(-90)")
      .attr("y", 0 - margin.left)
      .attr("x", 0 - (height / 2))
      .attr("dy", "1em")
      .text("Percentage of Lines (%)");
  } else {
    // For all episodes, render area chart
    renderAreaChart(svg, stackedSeries, stackedData, xScale, yScale, width, height, margin);

    // Add Y axis
    svg.append("g")
      .attr("class", "axis")
      .call(d3.axisLeft(yScale).tickFormat(d => d + "%"));

    // Add X axis
    const xAxis = d3.axisBottom(xScale)
      .tickFormat(d => filteredEpisodes[Math.round(d)] ? filteredEpisodes[Math.round(d)].name : "")
      .tickValues(d3.range(0, filteredEpisodes.length, Math.max(1, Math.floor(filteredEpisodes.length / 15))));

    svg.append("g")
      .attr("transform", `translate(0,${height})`)
      .attr("class", "axis")
      .call(xAxis)
      .selectAll("text")
      .attr("transform", "rotate(-45)")
      .attr("text-anchor", "end")
      .attr("dy", "0.5em")
      .attr("dx", "-0.5em");

    // Add axis labels
    svg.append("text")
      .attr("class", "axis-label")
      .attr("text-anchor", "middle")
      .attr("x", width / 2)
      .attr("y", height + 80)
      .text(isSeason ? `Season ${selectedSeason}` : "Episode");

    svg.append("text")
      .attr("class", "axis-label")
      .attr("text-anchor", "middle")
      .attr("transform", "rotate(-90)")
      .attr("y", 0 - margin.left)
      .attr("x", 0 - (height / 2))
      .attr("dy", "1em")
      .text("Percentage of Lines (%)");
  }


  // Create legend
  const legend = d3.select("#legend");
  legend.selectAll("*").remove();
  
  characters.forEach(character => {
    const item = legend.append("div")
      .attr("class", "legend-item");

    item.append("div")
      .attr("class", "legend-color")
      .style("background-color", colorScale(character));

    item.append("span")
      .text(character);
  });

  // Add interactive tooltip (only for area chart, pie chart handles its own)
  if (!isSingleEpisode) {
    svg.append("rect")
      .attr("width", width)
      .attr("height", height)
      .attr("fill", "none")
      .attr("pointer-events", "all")
      .on("mousemove", function(event) {
        const [mouseX, mouseY] = d3.pointer(event);
        const episodeIndex = Math.round(xScale.invert(mouseX));

        if (episodeIndex >= 0 && episodeIndex < filteredEpisodes.length) {
          const episode = filteredEpisodes[episodeIndex];
          let content = `<strong>${episode.name}</strong><br/>`;
          
          const sorted = [...episode.characters].sort((a, b) => b.percentage - a.percentage);
          sorted.slice(0, 5).forEach(char => {
            const percentage = char.percentage.toFixed(1);
            const lines = char.lines;
            content += `${char.name}: ${percentage}% (${lines} lines)<br/>`;
          });

          tooltip.html(content)
            .attr("class", "tooltip active")
            .style("left", (event.clientX + 10) + "px")
            .style("top", (event.clientY - 10) + "px");
        }
      })
      .on("mouseout", function() {
        tooltip.attr("class", "tooltip");
      });
  }
}

function renderStackedBar(svg, stackedSeries, stackedData, xScale, yScale, width, height, margin) {
  // Prepare data for pie chart
  const episode = stackedData[0];
  const piechartData = characterLinesData.characters
    .map(name => ({
      name: name,
      percentage: episode[name] || 0
    }))
    .filter(d => d.percentage > 0)
    .sort((a, b) => b.percentage - a.percentage);

  if (piechartData.length === 0) {
    svg.append("text")
      .attr("x", width / 2)
      .attr("y", height / 2)
      .attr("text-anchor", "middle")
      .attr("fill", "#999")
      .text("No data available");
    return;
  }

  // Calculate pie radius
  const radius = Math.min(width, height) / 2.5;

  // Create pie generator
  const pie = d3.pie()
    .value(d => d.percentage)
    .sort(null);

  const arc = d3.arc()
    .innerRadius(0)
    .outerRadius(radius);

  const arcLabel = d3.arc()
    .innerRadius(radius * 0.6)
    .outerRadius(radius * 0.6);

  // Center the pie chart
  const pieGroup = svg.append("g")
    .attr("transform", `translate(${width / 2},${height / 2})`);

  // Add slices
  const slices = pieGroup.selectAll(".pie-slice")
    .data(pie(piechartData))
    .enter()
    .append("g")
    .attr("class", "pie-slice");

  slices.append("path")
    .attr("d", arc)
    .attr("fill", d => colorScale(d.data.name))
    .attr("opacity", 0.85)
    .attr("stroke", "white")
    .attr("stroke-width", 2)
    .on("mouseover", function(event, d) {
      d3.select(this).attr("opacity", 1);
      tooltip
        .html(`<strong>${d.data.name}</strong><br/>${d.data.percentage.toFixed(1)}%`)
        .attr("class", "tooltip active")
        .style("left", (event.clientX + 10) + "px")
        .style("top", (event.clientY - 10) + "px");
    })
    .on("mousemove", function(event) {
      tooltip
        .style("left", (event.clientX + 10) + "px")
        .style("top", (event.clientY - 10) + "px");
    })
    .on("mouseout", function() {
      d3.select(this).attr("opacity", 0.85);
      tooltip.attr("class", "tooltip");
    });

  // Add labels
  slices.append("text")
    .attr("transform", d => `translate(${arcLabel.centroid(d)})`)
    .attr("text-anchor", "middle")
    .attr("font-size", "12px")
    .attr("font-weight", "600")
    .attr("fill", "white")
    .text(d => {
      const percentage = d.data.percentage;
      if (percentage > 5) {
        return `${percentage.toFixed(0)}%`;
      }
      return "";
    });
}

function renderAreaChart(svg, stackedSeries, stackedData, xScale, yScale, width, height, margin) {
  // Add grid
  svg.append("g")
    .attr("class", "grid")
    .call(d3.axisLeft(yScale)
      .tickSize(-width)
      .tickFormat("")
    );

  // Create area generator
  const area = d3.area()
    .x((d, i) => xScale(d.data.index))
    .y0(d => yScale(d[0]))
    .y1(d => yScale(d[1]));

  // Add areas
  svg.selectAll(".area")
    .data(stackedSeries)
    .enter()
    .append("path")
    .attr("class", "area")
    .attr("fill", d => colorScale(d.key))
    .attr("d", area)
    .on("mouseover", function(event, d) {
      d3.selectAll(".area").style("opacity", 0.3);
      d3.select(this).style("opacity", 1);
    })
    .on("mouseout", function() {
      d3.selectAll(".area").style("opacity", 0.8);
    });
}

// ============================================================================
// CHORD DIAGRAM
// ============================================================================

function renderChordChart(dataset) {
  // Clear previous chart
  const chordSvg = d3.select("#chordChart");
  chordSvg.selectAll("*").remove();

  const chart = parseTranscript(dataset.rows);
  const totalsByName = new Map(chart.totals.entries());
  const speakers = ALLOWED_CHARACTERS
    .map((name) => ({ name, words: totalsByName.get(name) || 0 }))
    .filter((speaker) => speaker.words > 0);

  if (speakers.length === 0) {
    statusText.textContent = "No speaker data found in this dataset.";
    return;
  }
  
  const includedNames = new Set(speakers.map((d) => d.name));

  const names = speakers.map((d) => d.name);
  const nameToIndex = new Map(names.map((name, index) => [name, index]));
  const matrix = Array.from({ length: names.length }, () => Array(names.length).fill(0));

  for (const [key, count] of chart.edges.entries()) {
    const [source, target] = key.split("|||");
    if (!includedNames.has(source) || !includedNames.has(target)) {
      continue;
    }
    const sourceIndex = nameToIndex.get(source);
    const targetIndex = nameToIndex.get(target);
    if (sourceIndex != null && targetIndex != null) {
      matrix[sourceIndex][targetIndex] += count;
    }
  }

  const chord = d3.chordDirected()
    .padAngle(0.03)
    .sortSubgroups(d3.descending)
    .sortChords(d3.descending)(matrix);

  const chordColor = d3.scaleOrdinal()
    .domain(names)
    .range(d3.quantize(d3.interpolateCool, Math.max(names.length, 3)));

  const svg = chordSvg
    .attr("viewBox", `0 0 ${chordWidth} ${chordHeight}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  const g = svg
    .append("g")
    .attr("transform", `translate(${centerX},${centerY})`);

  g.append("circle")
    .attr("r", outerRadius + 56)
    .attr("fill", "none")
    .attr("stroke", "rgba(255,255,255,0.05)")
    .attr("stroke-width", 1);

  const arc = d3.arc()
    .innerRadius(innerRadius)
    .outerRadius(outerRadius);

  const ribbon = d3.ribbon()
  .radius(innerRadius - 2)
  .padAngle(1 / innerRadius);

  const groups = g.append("g")
    .selectAll("g")
    .data(chord.groups)
    .join("g")
    .attr("class", "node-group");

  groups
    .append("path")
    .attr("class", "node-arc")
    .attr("d", arc)
    .attr("fill", (d) => chordColor(names[d.index]))
    .attr("fill-opacity", 0.86)
    .attr("stroke", "rgba(255,255,255,0.16)")
    .on("mouseenter", (event, d) => {
      const speaker = speakers[d.index];
      tooltip
        .style("opacity", 1)
        .html(`<strong>${speaker.name}</strong><br>${speaker.words.toLocaleString()} words spoken`)
        .attr("class", "tooltip active");
    })
    .on("mousemove", (event) => {
      tooltip.style("left", `${event.clientX + 14}px`).style("top", `${event.clientY + 14}px`);
    })
    .on("mouseleave", () => tooltip.style("opacity", 0).attr("class", "tooltip"));

  groups
  .append("text")
  .attr("class", "node-label")
  .attr("font-size", "16px")
  .attr("font-weight", "600")
  .each(function (d) {
    d.angle = (d.startAngle + d.endAngle) / 2;
  })
  .attr("dy", "0.35em")
  .attr("transform", function (d) {
    const angle = (d.angle * 180) / Math.PI - 90;
    const labelRadius = outerRadius + 18;

    if (d.angle > Math.PI) {
      return `rotate(${angle}) translate(${labelRadius}) rotate(180)`;
    }

    return `rotate(${angle}) translate(${labelRadius})`;
  })
  .style("text-anchor", (d) => (d.angle > Math.PI ? "end" : "start"))
  .text((d) => names[d.index]);

  g.append("g")
  .attr("fill-opacity", 0.35)
  .selectAll("path")
  .data(chord)
  .join("path")
  .attr("class", "link-path")
  .attr("d", ribbon)
  .attr("fill", (d) => chordColor(names[d.source.index]))
  .attr("stroke", "none")
    .on("mouseenter", (event, d) => {
      const source = names[d.source.index];
      const target = names[d.target.index];
      tooltip
        .style("opacity", 1)
        .html(`<strong>${source} → ${target}</strong><br>${d.source.value} transition${d.source.value === 1 ? "" : "s"}`)
        .attr("class", "tooltip active");

      g.selectAll("path.link-path").classed("active", false);
      d3.select(event.currentTarget).classed("active", true);
    })
    .on("mousemove", (event) => {
      tooltip.style("left", `${event.clientX + 14}px`).style("top", `${event.clientY + 14}px`);
    })
    .on("mouseleave", () => {
      tooltip.style("opacity", 0).attr("class", "tooltip");
      g.selectAll("path.link-path").classed("active", false);
    });

  renderSpeakerList([...speakers].sort((a, b) => b.words - a.words));
  statusText.textContent = `${dataset.label}: ${dataset.rows.length.toLocaleString()} dialogue rows, showing ${speakers.length} character${speakers.length === 1 ? "" : "s"}`;
}

function renderSpeakerList(entries) {
  speakerList.innerHTML = "";
  entries.slice(0, 10).forEach((entry, index) => {
    const li = document.createElement("li");
    li.innerHTML = `${entry.name} <span style="color: #999; margin-left: 5px;">${entry.words.toLocaleString()} words</span>`;
    speakerList.appendChild(li);
  });
}

// ============================================================================
// CAST SWATCHES (show overview)
// ============================================================================

function renderCastSwatches() {
  const container = document.getElementById("castSwatches");
  if (!container) return;
  ALLOWED_CHARACTERS.forEach(c => {
    const pill = document.createElement("div");
    pill.style.cssText = "display:flex;align-items:center;gap:6px;padding:5px 12px 5px 8px;background:#f5f5f5;border:1px solid #e0e0e0;border-radius:100px;font-size:13px;font-weight:600;color:#333;";
    const swatch = document.createElement("span");
    swatch.style.cssText = `width:10px;height:10px;border-radius:50%;background:${colorScale(c)};flex-shrink:0;`;
    pill.appendChild(swatch);
    pill.appendChild(document.createTextNode(c));
    container.appendChild(pill);
  });
}

// ============================================================================
// LINES SPOKEN BAR CHART
// ============================================================================

function renderLinesBarChart(dataset) {
  const svgEl = document.getElementById("linesBarChart");
  const svg = d3.select(svgEl);
  svg.selectAll("*").remove();
  if (!characterLinesData) return;

  // Aggregate lines for this dataset
  const episodes = characterLinesData.episodes;
  const isSeason = dataset && dataset.id.startsWith("season_");
  const isSingle = dataset && dataset.id !== "all" && !isSeason;
  const selectedSeason = isSeason ? parseInt(dataset.id.split("_")[1]) : null;

  const charTotals = {};
  ALLOWED_CHARACTERS.forEach(c => charTotals[c] = 0);

  episodes.forEach(ep => {
    const epSeason = extractSeason(ep.name);
    if (isSeason && epSeason !== selectedSeason) return;
    if (isSingle) {
      const epLabel = dataset.id.trim();
      if (ep.name !== epLabel) return;
    }
    ep.characters.forEach(cd => {
      if (charTotals[cd.name] !== undefined) {
        charTotals[cd.name] += cd.lines;
      }
    });
  });

  const data = ALLOWED_CHARACTERS
    .map(c => ({ name: c, lines: charTotals[c] }))
    .filter(d => d.lines > 0)
    .sort((a, b) => b.lines - a.lines);

  if (!data.length) return;

  const labelW = 72, rightPad = 60, barH = 24, rowH = 36;
  const W = svgEl.parentElement.clientWidth - 40;
  const iW = W - labelW - rightPad;
  const H = data.length * rowH + 8;

  svg.attr("width", W).attr("height", H);

  const maxVal = d3.max(data, d => d.lines);
  const xSc = d3.scaleLinear().domain([0, maxVal]).range([0, iW]);
  const g = svg.append("g").attr("transform", `translate(${labelW},4)`);

  // subtle grid
  g.append("g").attr("class","grid")
    .call(d3.axisBottom(xSc).ticks(5).tickSize(H - 8).tickFormat(""))
    .attr("transform","translate(0,0)")
    .select(".domain").remove();

  data.forEach((d, i) => {
    const row = g.append("g").attr("transform", `translate(0,${i * rowH})`);
    const bw = Math.max(xSc(d.lines), 3);

    row.append("text")
      .attr("x", -8).attr("y", barH / 2 + 5)
      .attr("text-anchor", "end")
      .attr("fill", colorScale(d.name))
      .attr("font-size", 13).attr("font-weight", 600)
      .attr("font-family", "inherit")
      .text(d.name);

    row.append("rect")
      .attr("x", 0).attr("y", 2)
      .attr("width", bw).attr("height", barH).attr("rx", 3)
      .attr("fill", colorScale(d.name)).attr("opacity", 0.8)
      .on("mouseover", function(evt) {
        d3.select(this).attr("opacity", 1);
        tooltip.html(`<strong>${d.name}</strong>${d.lines.toLocaleString()} lines`)
          .attr("class","tooltip active")
          .style("left", (evt.clientX + 10) + "px")
          .style("top", (evt.clientY - 10) + "px");
      })
      .on("mousemove", function(evt) {
        tooltip.style("left", (evt.clientX + 10) + "px").style("top", (evt.clientY - 10) + "px");
      })
      .on("mouseout", function() {
        d3.select(this).attr("opacity", 0.8);
        tooltip.attr("class","tooltip");
      });

    row.append("text")
      .attr("x", bw + 6).attr("y", barH / 2 + 5)
      .attr("fill", "#999").attr("font-size", 12).attr("font-family","inherit")
      .text(d.lines.toLocaleString());
  });
}

// ============================================================================
// SEASON / EPISODE INFO PANEL
// ============================================================================

let episodeInfoData = null;

async function loadEpisodeInfo() {
  const [descRes, infoRes] = await Promise.all([
    fetch("all_scripts/episode_descriptions.json"),
    fetch("all_scripts/episode_info.json")
  ]);
  if (!descRes.ok) throw new Error("Could not load episode_descriptions.json");
  if (!infoRes.ok) throw new Error("Could not load episode_info.json");
  const descData = await descRes.json();
  const infoData = await infoRes.json();
  // Merge: use episodes from descriptions (has description field), seasons from episode_info
  return {
    episodes: descData.episodes,
    seasons:  infoData.seasons
  };
}

function renderInfoPanel(dataset) {
  const panel    = document.getElementById("infoPanel");
  const title    = document.getElementById("infoPanelTitle");
  const desc     = document.getElementById("infoPanelDesc");
  const metaWrap = document.getElementById("infoPanelMeta");

  if (!episodeInfoData || !dataset || dataset.id === "all") {
    panel.style.display = "none";
    return;
  }

  panel.style.display = "block";
  metaWrap.innerHTML  = "";

  // ── Season view ───────────────────────────────────────────
  if (dataset.id.startsWith("season_")) {
    const sNum  = parseInt(dataset.id.split("_")[1]);
    const sData = episodeInfoData.seasons[String(sNum)];
    if (!sData) { panel.style.display = "none"; return; }

    title.textContent = `Season ${sNum} Overview`;
    desc.textContent  = sData.summary || "No summary available.";

    const metas = [
      { label: "Episodes",       value: sData.episode_count },
      { label: "Avg. IMDB",      value: sData.avg_imdb != null ? sData.avg_imdb.toFixed(2) : "N/A" },
      { label: "Avg. Viewers",   value: sData.avg_viewers != null ? sData.avg_viewers.toFixed(2) + "M" : "N/A" },
      { label: "Network",        value: sNum <= 5 ? "NBC" : "Yahoo! Screen" },
    ];
    metas.forEach(m => metaWrap.appendChild(makeMetaChip(m.label, m.value)));
    return;
  }

  // ── Single episode view ───────────────────────────────────
  // dataset.id is like "1x4 Social Psychology" — extract just the "1x4" part
  const codeMatch = dataset.id.match(/^(\d+x\d+)/);
  if (!codeMatch) { panel.style.display = "none"; return; }
  const epId  = codeMatch[1];
  const epObj = episodeInfoData.episodes.find(e => e.code === epId);
  if (!epObj) { panel.style.display = "none"; return; }

  title.textContent = `${epObj.code} — ${epObj.title}`;
  desc.textContent  = epObj.description || (epObj.air_date ? `Original air date: ${epObj.air_date}` : "");

  const metas = [
    { label: "Air Date",    value: epObj.air_date  || "—" },
    { label: "Directed by", value: epObj.director  || "—" },
    { label: "Written by",  value: epObj.writer    || "—" },
    { label: "IMDB Rating", value: epObj.imdb      != null ? epObj.imdb.toFixed(1) : "N/A" },
    { label: "Viewers",     value: epObj.viewers   != null ? epObj.viewers.toFixed(2) + "M" : "N/A" },
  ];
  metas.forEach(m => metaWrap.appendChild(makeMetaChip(m.label, m.value)));
}

function makeMetaChip(label, value) {
  const chip = document.createElement("div");
  chip.style.cssText = "padding: 12px 16px; background: #f5f5f5; border-left: 4px solid #667eea; border-radius: 0 4px 4px 0; min-width: 140px; max-width: 320px;";
  chip.innerHTML = `
    <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:#999;margin-bottom:4px;">${label}</div>
    <div style="font-size:15px;font-weight:600;color:#333;word-break:break-word;">${value}</div>
  `;
  return chip;
}

// ============================================================================
// EPISODE DISTINCTIVE WORDS CHART
// ============================================================================

let tfidfData = null;

async function loadTfidfData() {
  const res = await fetch("all_scripts/tfidf_episode_words.json");
  if (!res.ok) throw new Error("Could not load tfidf_episode_words.json");
  return res.json();
}

function renderEpisodeWordsChart(dataset) {
  const section = document.getElementById("episodeWordsSection");
  const svgEl   = document.getElementById("episodeWordsChart");
  const titleEl = document.getElementById("episodeWordsTitle");

  // Only show for single episode selections
  const isSingle = dataset && dataset.id !== "all" && !dataset.id.startsWith("season_");
  if (!isSingle || !tfidfData) {
    section.style.display = "none";
    return;
  }

  // Extract the SxE code from dataset.id e.g. "1x4 Social Psychology" -> "1x4"
  const codeMatch = dataset.id.match(/^(\d+x\d+)/);
  if (!codeMatch) { section.style.display = "none"; return; }
  const code = codeMatch[1];

  const words = tfidfData[code];
  if (!words || !words.length) { section.style.display = "none"; return; }

  section.style.display = "block";

  // Get episode title from the label e.g. "S1 E4 — Social Psychology"
  const titleMatch = dataset.label.match(/— (.+)$/);
  const epTitle = titleMatch ? titleMatch[1] : dataset.id;
  titleEl.textContent = `Distinctive Words — ${epTitle}`;

  const svg = d3.select(svgEl);
  svg.selectAll("*").remove();

  const top = words.slice(0, 12);
  const labelW = 110, rightPad = 60, barH = 26, rowH = 38;
  const W = svgEl.parentElement.clientWidth - 80;
  const iW = W - labelW - rightPad;
  const H = top.length * rowH + 8;

  svg.attr("width", W).attr("height", H);

  const maxScore = d3.max(top, d => d.tfidf_score);
  const xSc = d3.scaleLinear().domain([0, maxScore]).range([0, iW]);

  const g = svg.append("g").attr("transform", `translate(${labelW}, 4)`);

  // subtle grid
  g.append("g").attr("class", "grid")
    .call(d3.axisBottom(xSc).ticks(5).tickSize(H - 8).tickFormat(""))
    .attr("transform", "translate(0,0)")
    .select(".domain").remove();

  top.forEach((d, i) => {
    const row = g.append("g").attr("transform", `translate(0, ${i * rowH})`);
    const bw = Math.max(xSc(d.tfidf_score), 3);

    // word label
    row.append("text")
      .attr("x", -8).attr("y", barH / 2 + 5)
      .attr("text-anchor", "end")
      .attr("fill", "#667eea")
      .attr("font-size", 13).attr("font-weight", 600)
      .attr("font-family", "inherit")
      .text(d.word);

    // bar
    row.append("rect")
      .attr("x", 0).attr("y", 2)
      .attr("width", bw).attr("height", barH).attr("rx", 3)
      .attr("fill", "#667eea").attr("opacity", 0.65 + (d.tfidf_score / maxScore) * 0.3)
      .on("mouseover", function(evt) {
        d3.select(this).attr("opacity", 1);
        tooltip.html(`<strong>${d.word}</strong>TF-IDF score: ${d.tfidf_score.toFixed(3)}`)
          .attr("class", "tooltip active")
          .style("left", (evt.clientX + 10) + "px")
          .style("top", (evt.clientY - 10) + "px");
      })
      .on("mousemove", function(evt) {
        tooltip.style("left", (evt.clientX + 10) + "px").style("top", (evt.clientY - 10) + "px");
      })
      .on("mouseout", function() {
        d3.select(this).attr("opacity", 0.65 + (d.tfidf_score / maxScore) * 0.3);
        tooltip.attr("class", "tooltip");
      });

    // score label
    row.append("text")
      .attr("x", bw + 7).attr("y", barH / 2 + 5)
      .attr("fill", "#999").attr("font-size", 11).attr("font-family", "inherit")
      .text(d.tfidf_score.toFixed(3));
  });
}


async function init() {
  try {
    // Load both datasets
    allDatasets = await buildDatasetList();
    characterLinesData = await loadCharacterLinesData();
    episodeInfoData = await loadEpisodeInfo();
    tfidfData = await loadTfidfData();

    // Render static sections (don't depend on dataset selection)
    renderCastSwatches();
    
    const allEpisodes = makeAllEpisodesDataset(allDatasets);
    const seasonDatasets = makeSeasonDatasets(allDatasets);

    // Create options: All episodes, then seasons, then individual episodes
    const allOptions = [
      allEpisodes,
      ...seasonDatasets,
      ...allDatasets
    ];

    const options = allOptions.map((dataset) => ({
      value: dataset.id,
      label: dataset.label,
    }));

    datasetSelect.innerHTML = options
      .map((option) => `<option value="${option.value}">${option.label}</option>`)
      .join("");

    const datasetById = new Map(
      allOptions.map((dataset) => [dataset.id, dataset])
    );

    datasetSelect.addEventListener("change", () => {
      const dataset = datasetById.get(datasetSelect.value);
      if (dataset) {
        renderInfoPanel(dataset);
        renderEpisodeWordsChart(dataset);
        renderChordChart(dataset);
        renderStackedAreaChart(dataset);
        renderLinesBarChart(dataset);
      }
    });

    datasetSelect.value = "all";
    renderInfoPanel(null);
    renderEpisodeWordsChart(null);
    renderChordChart(allEpisodes);
    renderStackedAreaChart(allEpisodes);
    renderLinesBarChart(allEpisodes);
    
    statusText.textContent = "Ready";
  } catch (error) {
    console.error(error);
    statusText.textContent = `Unable to load scripts: ${error.message}`;
  }
}

init();