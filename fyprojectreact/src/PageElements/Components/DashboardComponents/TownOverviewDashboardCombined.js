
import Box from '@mui/material/Box';
import { LineChart } from '@mui/x-charts';
import { ChartsReferenceLine } from '@mui/x-charts/ChartsReferenceLine';
import {useEffect, useState, useMemo} from 'react';
import { WHOThresholds } from '../Backend/PollutionInfo';
export default function TownOverviewDashboardCombined({data, YearlyData, pollutant, limit}){

    let dateData = null;

    console.log("my limit is ", limit);
    const randomColor = () => {
        const letters = '0123456789ABCDEF';
        let color = '#';
        for (let i = 0; i < 6; i++) {
          color += letters[Math.floor(Math.random() * 16)];
        }
        return color;
    }

    const townsData = useMemo(() => {
        if (data == null || data.length === 0){
            return null;
        } else {
            let tempData = []
            Object.entries(data).map(([town, tData]) => {
                if(tData["DisplayData"] == null || tData["DisplayData"].length === 0){
                    return;
                }
                const displayData = tData["DisplayData"][0];
                console.log(`Display data ${displayData}`);
                const polData = tData["DisplayData"][0]["data"];
                tempData.push({"label": `${town} - ${pollutant}`, "data": polData, "color": randomColor()})
            })
            return tempData;
        }
    }, [data])



    const renderGraph = () => {
        return (
            <div className={"towns-graph-overview"}>
            <hr/>
            <Box >
                <LineChart
                    xAxis={[
                        {
                        data: YearlyData !== null ? YearlyData : [],
                        scaleType: 'time',      
                        zoom: true,
                        valueFormatter: (date) => {
                            const month = date.getMonth();
                            const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                            return `${monthNames[month]} ${date.getDate()}-${date.getMonth() + 1}-${date.getFullYear().toString()}`;
                        }
                        }
                    ]}
                    series={
                        [
                            ...townsData !== null ? townsData.map( d => (
                                d
                            )) : []
                        ]   
                    }
                    height={450}
                    sx={{
                        '.MuiChartsAxis-line': { stroke: '#fff !important' },       // axis lines white
                        '.MuiChartsAxis-tick': { stroke: '#fff !important' },       // tick marks white
                        '.MuiChartsAxis-tickLabel': { fill: '#fff !important' },    // tick text white
                        '.MuiChartsLegend-root': { color: '#fff !important' },      // legend white
                        '.MuiChartsTooltip-root': { color: '#fff !important' },     // tooltip text black
                        '.MuiChartsTooltip-paper': { background: '#fff !important' } // tooltip background white
                    }}
                    >
                    <ChartsReferenceLine
                        x="x" // value where the line hits
                        axis={limit} // because threshold is horizontal
                        stroke="red" // line color
                        strokeDasharray="4 2"
                        lineStyle={{ stroke: 'red', strokeWidth: 2, strokeDasharray: '5 5' }}  
                    />
                    </LineChart>
                </Box>
        </div>
        )
    }



    return (
        <>
        {data.length != 0 ? renderGraph() : null}
        </>
    )
    

}