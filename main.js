// ============================================================================
// SHARED CONFIGURATION & UTILITIES
// ============================================================================

const ALLOWED_CHARACTERS = [
  "Jeff",
  "Abed",
  "Shirley",
  "Britta",
  "Troy",
  "Pierce",
  "Duncan",
  "Chang",
  "Pelton",
];

const colorScale = d3.scaleOrdinal()
    .domain(ALLOWED_CHARACTERS)
    .range([
        "#1f77b4",  // Jeff - blue
        "#ff7f0e",  // Abed - orange
        "#2ca02c",  // Shirley - green
        "#d62728",  // Britta - red
        "#9467bd",  // Troy - purple
        "#8c564b",  // Pierce - brown
        "#e377c2",  // Duncan - pink
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
const outerRadius = 300;
const innerRadius = 220;

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
      label: entry.episode ? `${entry.episode} • ${entry.file.replace(/\.csv$/i, "")}` : entry.file,
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

  const margin = { top: 20, right: 30, bottom: 60, left: 60 };
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
    const episodeName = dataset.label.split(" • ")[0].trim();
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
      .attr("y", height + 50)
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
            .style("left", (event.pageX + 10) + "px")
            .style("top", (event.pageY - 10) + "px");
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
        .style("left", (event.pageX + 10) + "px")
        .style("top", (event.pageY - 10) + "px");
    })
    .on("mousemove", function(event) {
      tooltip
        .style("left", (event.pageX + 10) + "px")
        .style("top", (event.pageY - 10) + "px");
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

  const ribbon = d3.ribbonArrow()
    .radius(innerRadius - 2)
    .padAngle(1 / innerRadius)
    .headRadius(8);

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
    .each(function (d) {
      d.angle = (d.startAngle + d.endAngle) / 2;
    })
    .attr("dy", "0.35em")
    .attr("transform", function (d) {
      const angle = (d.angle * 180) / Math.PI - 90;
      const rotate = angle + (d.angle > Math.PI ? 180 : 0);
      return `rotate(${rotate}) translate(${outerRadius + 14}) ${d.angle > Math.PI ? "rotate(180)" : ""}`;
    })
    .style("text-anchor", (d) => (d.angle > Math.PI ? "end" : "start"))
    .text((d) => names[d.index]);

  g.append("g")
    .attr("fill-opacity", 0.8)
    .selectAll("path")
    .data(chord)
    .join("path")
    .attr("class", "link-path")
    .attr("d", ribbon)
    .attr("stroke", (d) => chordColor(names[d.source.index]))
    .attr("stroke-width", (d) => Math.max(1, Math.sqrt(d.source.value)))
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
// INITIALIZATION
// ============================================================================

async function init() {
  try {
    // Load both datasets
    allDatasets = await buildDatasetList();
    characterLinesData = await loadCharacterLinesData();
    
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
        renderChordChart(dataset);
        // Stacked area chart updates based on selection: shows all episodes or single episode breakdown
        renderStackedAreaChart(dataset);
      }
    });

    datasetSelect.value = "all";
    renderChordChart(allEpisodes);
    renderStackedAreaChart(allEpisodes);
    
    statusText.textContent = "Ready";
  } catch (error) {
    console.error(error);
    statusText.textContent = `Unable to load scripts: ${error.message}`;
  }
}

init();
